/**
 * reviews-finalize — DataForSEO pingback receiver (Phase 2 of review enrichment).
 *
 * pipeline-run posts two review tasks per imported lead (20 newest + 20 lowest rated).
 * DataForSEO calls this function when each task finishes:
 *   GET /reviews-finalize?id=<task_id>&tag=<place_id>&secret=<PIPELINE_SECRET>
 *
 * On each ping: fetch the task result, store the reviews. When BOTH sorts for a place are in,
 * merge them (up to 40 reviews with dates) and re-score pain_points + personalization_notes with
 * OpenAI, updating both sourced_places and the imported CRM lead. Balanced good+bad reviews give
 * the sales team real, sellable pain points instead of Google's 5 relevance-picked positives.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PIPELINE_SECRET = Deno.env.get('PIPELINE_SECRET') ?? ''
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY')!
const DFS_LOGIN = Deno.env.get('DATAFORSEO_LOGIN') ?? ''
const DFS_PASSWORD = Deno.env.get('DATAFORSEO_PASSWORD') ?? ''

type Review = { text: string; rating: number | null; time: string | null }

function svcHeaders(extra: Record<string, string> = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra }
}

async function dbSelect<T>(table: string, qs: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: svcHeaders() })
  if (!res.ok) throw new Error(`dbSelect ${table}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function dbUpdate(table: string, body: unknown, qs: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: svcHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) console.error(`dbUpdate ${table}: ${res.status} ${await res.text()}`)
}

// ---------------------------------------------------------------------------
// Review-insights re-scoring (pain_points is what we sell — this is the payoff step)
// ---------------------------------------------------------------------------

const INSIGHTS_PROMPT = `You are a lead-qualification analyst for a web design agency selling website redesigns to med spas and aesthetic clinics. You are given a rich sample of a clinic's Google reviews — up to 20 MOST RECENT and up to 20 LOWEST-RATED, each with a date — plus WHAT WE FOUND ON THEIR WEBSITE (defects our scanner detected).

Return:

pain_points — ALL the sellable outreach angles for this lead, most compelling first.
FORMAT: if there is more than one angle, output a NUMBERED list with each on its OWN line ("1. …\n2. …\n3. …"). If there is only one, output it as a single plain sentence (no number). Keep each point to one tight sentence a setter can say on a call.
Which angles to include (in priority order):
- If the WEBSITE FINDINGS say there is NO REAL WEBSITE (only a 3rd-party booking page like Square/Fresha/Vagaro/Facebook), make THIS point #1: they have no website of their own — just a rented booking link that isn't truly theirs and looks unprofessional next to competitors.
- If the WEBSITE FINDINGS say the business is RUNNING GOOGLE ADS, that is a top point: they are paying Google to send clicks to a weak site that cannot convert them (wasted ad spend) — pair it with a concrete site defect.
- Review friction that CORROBORATES a detected website defect (reviewers can't get through to book AND the site has no booking flow; nobody replies AND no email published). Connect them explicitly. Never invent website defects not in the findings.
- Other review friction we can fix with a better website — hard to book, phone never answered, no online booking, slow replies, scheduling chaos. Say roughly how many reviewers mention it. Distinguish website-fixable friction from service complaints (bad injections, rude staff) — service complaints are context, NOT our pitch.
- Use dates: recent friction is hot; if ALL reviews are years old, note the business looks dormant.
- If there is genuinely no friction anywhere, give the dominant praise theme from recent reviews (name the provider/treatment) — as a single point, no numbering.

personalization_notes — 1-2 short, specific cold-outreach hooks quoting or referencing actual review content (names, treatments, phrases). No fabrication, no generic flattery.

Ground every word in the supplied reviews and website findings. Never invent.`

const INSIGHTS_SCHEMA = {
  name: 'review_insights',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      pain_points: { type: 'string', description: 'Most sellable angle from the balanced review sample, friction first.' },
      personalization_notes: { type: 'string', description: '1-2 hooks quoting actual review content.' },
    },
    required: ['pain_points', 'personalization_notes'],
    additionalProperties: false,
  },
}

async function rescoreInsights(businessName: string, recent: Review[], low: Review[], siteContext: string): Promise<{ pain_points: string; personalization_notes: string } | null> {
  const fmt = (rs: Review[]) => rs.map((r) => `[${r.rating ?? '?'}★${r.time ? ' ' + String(r.time).slice(0, 10) : ''}] ${r.text.slice(0, 400)}`).join('\n')
  const user = `Business: ${businessName}

WEBSITE FINDINGS (from our scanner — the only site defects you may reference):
${siteContext || '(none available)'}

MOST RECENT reviews (${recent.length}):
${fmt(recent) || '(none)'}

LOWEST-RATED reviews (${low.length}):
${fmt(low) || '(none)'}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: INSIGHTS_PROMPT },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: INSIGHTS_SCHEMA },
      max_tokens: 400,
      temperature: 0.2,
    }),
  })
  if (!res.ok) { console.error(`[insights] OpenAI ${res.status}: ${await res.text()}`); return null }
  const data = await res.json()
  try { return JSON.parse(data?.choices?.[0]?.message?.content ?? '') } catch { return null }
}

// ---------------------------------------------------------------------------
// Core Web Vitals via Google PageSpeed Insights (free API). Runs here — post-import, async — because
// a PSI run takes 10-25s, far too slow for the import chunk. Gives REAL mobile render performance
// (vs the scraper's raw-fetch timing) for honest "slow site" pain points.
// ---------------------------------------------------------------------------
const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''

function seoTag(n: number): string { return n >= 80 ? 'Good' : n >= 50 ? 'Weak' : 'Critical' }

// PageSpeed renders the JavaScript, so it also scores SEO on JS-shell sites (Wix, etc.) that our
// raw-HTML scanner had to skip. We request BOTH categories in the one call (still free) — performance
// feeds the "slow site" signal, and Lighthouse's SEO score is a fallback when our verified score is null.
async function fetchCwv(siteUrl: string): Promise<{ performance: number | null; seo: number | null; lcpMs: number | null } | null> {
  const call = async (withKey: boolean) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45_000)
    const u = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(siteUrl)}&strategy=mobile&category=performance&category=seo${withKey && GOOGLE_KEY ? `&key=${GOOGLE_KEY}` : ''}`
    const res = await fetch(u, { signal: controller.signal })
    clearTimeout(timer)
    return res
  }
  try {
    let res = await call(true)
    if (res.status === 403 || res.status === 400) res = await call(false) // key not enabled for PSI — keyless quota is fine at our volume
    if (!res.ok) return null
    const j = await res.json()
    const cats = j?.lighthouseResult?.categories
    const perf = cats?.performance?.score
    const seo = cats?.seo?.score
    if (perf == null && seo == null) return null
    const lcp = j?.lighthouseResult?.audits?.['largest-contentful-paint']?.numericValue
    return {
      performance: perf != null ? Math.round(perf * 100) : null,
      seo: seo != null ? Math.round(seo * 100) : null,
      lcpMs: lcp != null ? Math.round(lcp) : null,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Google Ads task retrieval (posted at import by pipeline-run, standard queue). Exact-domain match
// in the Ads Transparency result = the business is running Google ads.
// ---------------------------------------------------------------------------
async function resolveAdsTask(taskId: string, domain: string): Promise<{ runsAds: boolean; adsCount: number } | null> {
  if (!DFS_LOGIN || !DFS_PASSWORD) return null
  try {
    const res = await fetch(`https://api.dataforseo.com/v3/serp/google/ads_advertisers/task_get/advanced/${taskId}`, {
      headers: { Authorization: 'Basic ' + btoa(`${DFS_LOGIN}:${DFS_PASSWORD}`) },
    })
    if (!res.ok) return null
    const task = (await res.json())?.tasks?.[0]
    if (!task) return null
    // 40102 "No Search Results" is a FINAL verdict: no advertiser exists for this domain.
    if (task.status_code === 40102) return { runsAds: false, adsCount: 0 }
    if (task.status_code !== 20000) return null // still queued / transient — leave unresolved, retry next time
    const items: Array<{ type?: string; domain?: string; approx_ads_count?: number }> = task.result?.[0]?.items ?? []
    // The task's keyword IS the domain we queried; match against it (fallback to passed domain).
    const bare = String(task.data?.keyword ?? domain).replace(/^www\./, '').toLowerCase()
    let runsAds = false, adsCount = 0
    for (const it of items) {
      if (it.type === 'ads_domain' && String(it.domain ?? '').replace(/^www\./, '').toLowerCase() === bare) runsAds = true
      if ((it.type === 'ads_advertiser' || it.type === 'ads_multi_account_advertiser') && it.approx_ads_count) {
        adsCount = Math.max(adsCount, it.approx_ads_count)
      }
    }
    return { runsAds, adsCount: runsAds ? adsCount : 0 }
  } catch (e) {
    console.error('[ads] resolve failed:', (e as Error).message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  if (PIPELINE_SECRET && url.searchParams.get('secret') !== PIPELINE_SECRET) {
    return new Response('unauthorized', { status: 401 })
  }
  const taskId = url.searchParams.get('id')
  if (!taskId) return new Response('missing id', { status: 400 })

  try {
    // 1. Fetch the finished task from DataForSEO.
    const r = await fetch(`https://api.dataforseo.com/v3/business_data/google/reviews/task_get/${taskId}`, {
      headers: { Authorization: 'Basic ' + btoa(`${DFS_LOGIN}:${DFS_PASSWORD}`) },
    })
    if (!r.ok) throw new Error(`task_get HTTP ${r.status}`)
    const j = await r.json()
    const task = j?.tasks?.[0]
    if (!task || (task.status_code !== 20000)) {
      await dbUpdate('review_tasks', { status: 'failed' }, `task_id=eq.${taskId}`)
      return new Response(JSON.stringify({ ok: false, status: task?.status_code }), { status: 200 })
    }

    const items: Array<{ review_text?: string; rating?: { value?: number }; timestamp?: string }> = task.result?.[0]?.items ?? []
    const reviews: Review[] = items
      .map((i) => ({ text: i.review_text ?? '', rating: i.rating?.value ?? null, time: i.timestamp ?? null }))
      .filter((rv) => rv.text && rv.text.trim().length > 0)

    // 2. Store this task's reviews.
    await dbUpdate('review_tasks', { status: 'done', reviews }, `task_id=eq.${taskId}`)

    // 3. When both sorts for this place are done, merge + re-score.
    const rows = await dbSelect<{ task_id: string; place_id: string; sort: string | null; status: string; reviews: Review[] | null }>(
      'review_tasks', `task_id=eq.${taskId}&select=place_id`)
    const placeId = rows[0]?.place_id
    if (!placeId) return new Response(JSON.stringify({ ok: true, note: 'no task row' }), { status: 200 })

    const pair = await dbSelect<{ sort: string | null; status: string; reviews: Review[] | null }>(
      'review_tasks', `place_id=eq.${placeId}&select=sort,status,reviews&order=created_at.desc`)
    const done = pair.filter((p) => p.status === 'done')
    if (done.length < 2) return new Response(JSON.stringify({ ok: true, note: 'waiting for pair' }), { status: 200 })

    // 'newest' is the current sort; tolerate 'highest_rating' rows from older runs.
    const recent = done.find((p) => p.sort === 'newest' || p.sort === 'highest_rating')?.reviews ?? []
    const lowRaw = done.find((p) => p.sort === 'lowest_rating')?.reviews ?? []
    // De-dup: on small businesses both sorts can return overlapping reviews.
    const seen = new Set(recent.map((rv) => rv.text))
    const low = lowRaw.filter((rv) => !seen.has(rv.text))
    if (recent.length + low.length < 3) {
      return new Response(JSON.stringify({ ok: true, note: 'too few reviews to rescore' }), { status: 200 })
    }

    // 4. Re-score pain points + personalization on the balanced sample, cross-checked against the
    // site defects our scanner actually found (so reviews + website connect into ONE narrative).
    const place = (await dbSelect<{ name: string; crm_lead_id: string | null; website: string | null; website_status: string | null; site_issue_note: string | null; status_reason: string | null; runs_google_ads: boolean | null; google_ads_count: number | null; ads_task_id: string | null; cwv_performance: number | null; seo_score: number | null }>(
      'sourced_places', `place_id=eq.${placeId}&select=name,crm_lead_id,website,website_status,site_issue_note,status_reason,runs_google_ads,google_ads_count,ads_task_id,cwv_performance,seo_score`))[0]
    if (!place) return new Response(JSON.stringify({ ok: true, note: 'place not found' }), { status: 200 })

    // Google PageSpeed (once per place): mobile performance + an SEO fallback. Runs when either the
    // performance OR the SEO score is still missing on a real site — the latter backfills JS-shell
    // sites (Wix, etc.) our raw-HTML SEO pass couldn't verify. lhSeo is the Lighthouse SEO score we
    // actually wrote (null unless our verified score was absent), used to label the CRM field below.
    let lhSeo: number | null = null
    if (place.website && place.website_status !== 'none' && (place.cwv_performance == null || place.seo_score == null)) {
      const cwv = await fetchCwv(place.website)
      if (cwv) {
        const patch: Record<string, unknown> = {}
        if (place.cwv_performance == null && cwv.performance != null) { place.cwv_performance = cwv.performance; patch.cwv_performance = cwv.performance }
        if (place.seo_score == null && cwv.seo != null) { place.seo_score = cwv.seo; lhSeo = cwv.seo; patch.seo_score = cwv.seo }
        if (Object.keys(patch).length) await dbUpdate('sourced_places', patch, `place_id=eq.${placeId}`)
      }
    }

    // Resolve the Google Ads task posted at import (standard queue — done by now). Sets runs_google_ads.
    if (place.ads_task_id && place.runs_google_ads == null) {
      const ads = await resolveAdsTask(place.ads_task_id, '')
      if (ads) {
        place.runs_google_ads = ads.runsAds
        place.google_ads_count = ads.adsCount || null
        await dbUpdate('sourced_places', { runs_google_ads: ads.runsAds, google_ads_count: ads.adsCount || null }, `place_id=eq.${placeId}`)
      }
    }
    const adsLabel = place.runs_google_ads == null ? null
      : place.runs_google_ads ? `Yes${place.google_ads_count ? ` (~${place.google_ads_count} ads)` : ''}` : 'No / not detected'

    const siteContext = [
      place.website_status ? `Website status: ${place.website_status}` : '',
      place.site_issue_note && place.site_issue_note !== 'N/A' ? `Detected site issues: ${place.site_issue_note}` : '',
      place.runs_google_ads ? `RUNNING GOOGLE ADS: yes${place.google_ads_count ? ` (~${place.google_ads_count} active ads)` : ''} — paying for clicks into this weak site` : '',
      place.cwv_performance != null && place.cwv_performance < 50 ? `Mobile performance score ${place.cwv_performance}/100 (Google PageSpeed) — the site is measurably slow on phones` : '',
      place.status_reason ? `Assessment: ${place.status_reason}` : '',
    ].filter(Boolean).join('\n')

    const insights = await rescoreInsights(place.name ?? 'this business', recent, low, siteContext)
    if (!insights) return new Response(JSON.stringify({ ok: false, note: 'rescore failed' }), { status: 200 })

    await dbUpdate('sourced_places', {
      pain_points: insights.pain_points,
      personalization_notes: insights.personalization_notes,
    }, `place_id=eq.${placeId}`)

    // 5. Push into the imported CRM lead too (read-merge-write on the data jsonb).
    if (place.crm_lead_id) {
      const lead = (await dbSelect<{ data: Record<string, unknown> }>('leads', `id=eq.${place.crm_lead_id}&select=data`))[0]
      if (lead) {
        const data: Record<string, unknown> = { ...lead.data, 'Pain Points': insights.pain_points, 'Personalization Notes': insights.personalization_notes }
        if (adsLabel != null) data['Running Google Ads'] = adsLabel
        if (place.cwv_performance != null) {
          const tag = place.cwv_performance >= 90 ? 'Good' : place.cwv_performance >= 50 ? 'Slow' : 'Critical'
          data['Performance Score'] = `${place.cwv_performance}/100 — ${tag} (Google PageSpeed, mobile)`
        }
        // Only when our verified raw-HTML score was absent — labelled so it's not conflated with it.
        if (lhSeo != null) data['SEO Score'] = `${lhSeo}/100 — ${seoTag(lhSeo)} (Google Lighthouse)`
        await dbUpdate('leads', { data }, `id=eq.${place.crm_lead_id}`)
      }
    }

    console.log(`[reviews-finalize] ${place.name}: rescored from ${recent.length} recent + ${low.length} lowest reviews`)
    return new Response(JSON.stringify({ ok: true, rescored: true }), { status: 200 })
  } catch (e) {
    console.error('[reviews-finalize] error:', (e as Error).message)
    await dbUpdate('review_tasks', { status: 'failed' }, `task_id=eq.${taskId}`).catch(() => {})
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 })
  }
})
