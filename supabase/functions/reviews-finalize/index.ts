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

pain_points — the single most sellable outreach angle:
- STRONGEST possible angle: review friction that CORROBORATES a detected website defect (e.g. reviewers say they can't get through to book AND the site has no booking flow; reviewers say nobody replies AND the site publishes no email). When reviews and the website findings line up, connect them EXPLICITLY — that one-two punch is the pitch. Never invent website defects that are not in the findings.
- Otherwise: friction from the reviews we can fix with a better website — hard to book, phone never answered, no online booking, slow replies, scheduling chaos, communication problems. Say roughly how many reviewers mention it.
- Distinguish website-fixable friction (booking/contact/communication) from service complaints (bad injections, rude staff, results) — mention service complaints only as context, they are NOT our pitch.
- Use the dates: the MOST RECENT reviews show current reality — friction there is hot. If ALL reviews are years old, say the business looks dormant.
- If there is no real friction anywhere (low-rated are still 4-5★ or trivial gripes), say the reputation is uniformly strong and give the dominant praise theme from the recent reviews (name the provider/treatment reviewers mention).

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
    const place = (await dbSelect<{ name: string; crm_lead_id: string | null; website_status: string | null; site_issue_note: string | null; status_reason: string | null }>(
      'sourced_places', `place_id=eq.${placeId}&select=name,crm_lead_id,website_status,site_issue_note,status_reason`))[0]
    if (!place) return new Response(JSON.stringify({ ok: true, note: 'place not found' }), { status: 200 })

    const siteContext = [
      place.website_status ? `Website status: ${place.website_status}` : '',
      place.site_issue_note && place.site_issue_note !== 'N/A' ? `Detected site issues: ${place.site_issue_note}` : '',
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
        await dbUpdate('leads', {
          data: { ...lead.data, 'Pain Points': insights.pain_points, 'Personalization Notes': insights.personalization_notes },
        }, `id=eq.${place.crm_lead_id}`)
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
