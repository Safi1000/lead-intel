import { useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download } from 'lucide-react'
import { manualLeadsApi } from '../../api/endpoints'
import { LoadingState, ErrorState } from '../../components/feedback'
import { AUDIT_BRAND } from '../../config/auditBrand'
import { buildAudit, type Severity } from './auditModel'

/**
 * Client-facing white-label Audit report — a standalone, print-optimised page.
 * "Download PDF" calls window.print(); the browser's own (Chromium) print engine renders the
 * file — zero server cost, identical output. Opened with ?print=1 it auto-opens the print dialog.
 */

const AUDIT_CSS = `
.audit-root{--sheet:#fff;--ink:#16242A;--muted:#5C6E73;--faint:#849699;--line:#E2E8E7;--line-soft:#EDF1F0;
  --good:#2F7D57;--good-bg:#E7F1EB;--warn:#B5741C;--warn-bg:#F7EEDD;--crit:#B23A2E;--crit-bg:#F7E5E1;
  --brand-bright:color-mix(in srgb, var(--brand) 68%, white);
  --font-sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --font-serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --font-mono:ui-monospace,"Cascadia Code","Segoe UI Mono",Consolas,monospace;
  background:#E9EDEC;min-height:100vh;color:var(--ink);font-family:var(--font-sans);line-height:1.6;
  -webkit-font-smoothing:antialiased;color-scheme:light}
.audit-root *{box-sizing:border-box}
.audit-bar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 18px;background:#fff;border-bottom:1px solid var(--line)}
.audit-bar a,.audit-bar button{font-family:var(--font-sans)}
.audit-back{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);text-decoration:none}
.audit-back:hover{color:var(--ink)}
.audit-dl{display:inline-flex;align-items:center;gap:8px;background:var(--brand);color:#fff;border:none;cursor:pointer;
  font-weight:600;font-size:14px;padding:10px 18px;border-radius:9px}
.audit-dl:hover{background:var(--brand-bright)}
.audit-scroll{padding:26px 18px 60px}

.audit-sheet{max-width:820px;margin:0 auto;background:var(--sheet);border:1px solid var(--line);border-radius:14px;
  box-shadow:0 1px 2px rgba(16,40,46,.06),0 24px 60px -24px rgba(16,40,46,.28);overflow:hidden}
.audit-pad{padding:clamp(26px,5vw,50px)}
.audit-brandbar{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  padding:20px clamp(26px,5vw,50px);border-bottom:1px solid var(--line)}
.audit-brand{display:flex;align-items:center;gap:11px}
.audit-logo{width:34px;height:34px;border-radius:9px;flex:none;display:grid;place-items:center;color:#fff;font-weight:700;
  font-size:15px;background:linear-gradient(150deg,var(--brand),var(--brand-bright))}
.audit-bname{font-weight:700;font-size:15px;letter-spacing:-.01em}
.audit-btag{font-family:var(--font-mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted)}
.audit-bmeta{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.04em;color:var(--faint);text-align:right;line-height:1.6}

.audit-eyebrow{font-family:var(--font-mono);font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--brand);font-weight:600}
.audit-hero{display:grid;grid-template-columns:1fr auto;gap:26px;align-items:start;break-inside:avoid}
.audit-hero h1{font-size:clamp(28px,5vw,40px);line-height:1.05;letter-spacing:-.025em;font-weight:750;margin:12px 0 0;text-wrap:balance}
.audit-subject{margin-top:11px;font-family:var(--font-mono);font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:9px 14px;align-items:center}
.audit-subject .star{color:var(--warn)}
.audit-verdict{margin:18px 0 0;font-size:clamp(15px,2.2vw,17.5px);line-height:1.55;max-width:52ch}
.audit-verdict b{color:var(--brand)}
.audit-grade{flex:none;width:130px;text-align:center}
.audit-dial{position:relative;width:130px;height:130px;border-radius:50%;display:grid;place-items:center;
  background:conic-gradient(var(--dial) calc(var(--val)*1%),var(--line-soft) 0)}
.audit-dial::before{content:"";position:absolute;inset:11px;border-radius:50%;background:var(--sheet)}
.audit-dial-in{position:relative;text-align:center}
.audit-dial-num{font-size:37px;font-weight:750;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1}
.audit-dial-den{font-family:var(--font-mono);font-size:10.5px;color:var(--faint)}
.audit-glabel{margin-top:10px;font-family:var(--font-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:600}

.audit-sechead{display:flex;align-items:center;gap:14px;margin:0 0 18px}
.audit-sechead h2{font-family:var(--font-mono);font-size:11.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);font-weight:600;margin:0;white-space:nowrap}
.audit-sechead::after{content:"";height:1px;background:var(--line);flex:1}
.audit-band{padding-top:clamp(28px,5vw,42px);margin-top:clamp(28px,5vw,42px);border-top:1px solid var(--line-soft)}

.audit-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:13px}
.audit-card{border:1px solid var(--line);border-radius:11px;padding:15px;display:flex;flex-direction:column;gap:9px;min-width:0;break-inside:avoid}
.audit-ctop{display:flex;align-items:center;justify-content:space-between;gap:6px}
.audit-clabel{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.audit-pill{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;padding:3px 8px;border-radius:999px;white-space:nowrap}
.audit-pill.crit{color:var(--crit);background:var(--crit-bg)}.audit-pill.warn{color:var(--warn);background:var(--warn-bg)}.audit-pill.good{color:var(--good);background:var(--good-bg)}
.audit-cval{font-size:28px;font-weight:730;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1}
.audit-cval small{font-size:13px;color:var(--faint);font-weight:600}
.audit-meter{height:6px;border-radius:999px;background:var(--line-soft);overflow:hidden}
.audit-meter>span{display:block;height:100%;border-radius:999px}
.audit-meter.crit>span{background:var(--crit)}.audit-meter.warn>span{background:var(--warn)}.audit-meter.good>span{background:var(--good)}
.audit-cnote{font-size:11.5px;color:var(--muted);line-height:1.45}

.audit-finds{display:flex;flex-direction:column;gap:13px}
.audit-find{display:grid;grid-template-columns:4px 1fr;border:1px solid var(--line);border-radius:11px;overflow:hidden;break-inside:avoid}
.audit-find.crit>.audit-stripe{background:var(--crit)}.audit-find.warn>.audit-stripe{background:var(--warn)}.audit-find.good>.audit-stripe{background:var(--good)}
.audit-fbody{padding:15px 18px}
.audit-ftop{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.audit-ftitle{font-size:15.5px;font-weight:680;letter-spacing:-.01em}
.audit-fdesc{margin:6px 0 0;font-size:14px;color:var(--muted);line-height:1.55;max-width:64ch}

.audit-voice{background:var(--brand);color:#fff;border-radius:12px;padding:clamp(24px,4vw,32px);position:relative;overflow:hidden;break-inside:avoid}
.audit-voice .qmark{position:absolute;top:-16px;right:20px;font-family:var(--font-serif);font-size:120px;color:rgba(255,255,255,.12);line-height:1}
.audit-voice .audit-eyebrow{color:rgba(255,255,255,.72)}
.audit-voice blockquote{font-family:var(--font-serif);font-size:clamp(18px,3vw,23px);line-height:1.42;margin:13px 0 0;max-width:42ch;font-weight:500}
.audit-voice cite{display:block;margin-top:15px;font-style:normal;font-family:var(--font-mono);font-size:11px;color:rgba(255,255,255,.75)}

.audit-cta{border:1px solid var(--line);border-radius:12px;padding:clamp(24px,4vw,32px);background:var(--line-soft);break-inside:avoid}
.audit-cta h3{font-size:clamp(19px,3vw,24px);letter-spacing:-.02em;font-weight:730;margin:9px 0 0;max-width:26ch;text-wrap:balance}
.audit-cta p{margin:11px 0 0;font-size:14.5px;color:var(--muted);line-height:1.6;max-width:58ch}
.audit-ctarow{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-top:20px}
.audit-btn{display:inline-flex;align-items:center;gap:9px;background:var(--brand);color:#fff;text-decoration:none;font-weight:640;font-size:14.5px;padding:12px 22px;border-radius:10px}
.audit-contact{font-family:var(--font-mono);font-size:11.5px;color:var(--muted);line-height:1.7}
.audit-contact b{color:var(--ink);font-weight:600}
.audit-foot{padding:20px clamp(26px,5vw,50px);border-top:1px solid var(--line);font-family:var(--font-mono);font-size:10px;letter-spacing:.03em;color:var(--faint);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.audit-stack{display:flex;flex-direction:column}

@media (max-width:600px){.audit-hero{grid-template-columns:1fr}.audit-grade{width:auto;display:flex;align-items:center;gap:16px;justify-self:start}.audit-glabel{margin-top:0}}
@media print{
  .no-print{display:none!important}
  .audit-root{background:#fff}
  .audit-scroll{padding:0}
  .audit-sheet{max-width:none;border:none;border-radius:0;box-shadow:none}
  @page{size:Letter;margin:12mm}
}
`

const sevColor: Record<Severity, string> = { crit: 'var(--crit)', warn: 'var(--warn)', good: 'var(--good)' }
const sevPillLabel: Record<Severity, string> = { crit: 'Critical', warn: 'Worth fixing', good: 'Healthy' }

export function AuditReportPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { data: lead, isLoading, isError, refetch } = useQuery({
    queryKey: ['manual-lead', id], queryFn: () => manualLeadsApi.get(id as string), enabled: !!id,
  })

  const brand = AUDIT_BRAND
  const autoPrint = params.get('print') === '1'

  useEffect(() => {
    if (lead && autoPrint) {
      const t = setTimeout(() => window.print(), 500)
      return () => clearTimeout(t)
    }
  }, [lead, autoPrint])

  if (isLoading) return <LoadingState />
  if (isError || !lead) return <ErrorState onRetry={() => refetch()} />

  const a = buildAudit(lead)
  const firstName = a.businessName.split(/\s+/)[0]

  return (
    <div className="audit-root" style={{ ['--brand' as string]: brand.accent }}>
      <style>{AUDIT_CSS}</style>

      <div className="audit-bar no-print">
        <Link to={`/leads/manual/${lead.id}`} className="audit-back"><ArrowLeft className="h-4 w-4" /> Back to lead</Link>
        <button className="audit-dl" onClick={() => window.print()}><Download className="h-4 w-4" /> Download PDF</button>
      </div>

      <div className="audit-scroll">
        <article className="audit-sheet">
          <header className="audit-brandbar">
            <div className="audit-brand">
              <div className="audit-logo">{brand.logoText}</div>
              <div>
                <div className="audit-bname">{brand.name}</div>
                <div className="audit-btag">{brand.tagline}</div>
              </div>
            </div>
            <div className="audit-bmeta">Website &amp; Presence Audit<br />Prepared {new Date().toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </header>

          <div className="audit-pad audit-stack">
            {/* Hero */}
            <section className="audit-hero">
              <div>
                <div className="audit-eyebrow">Complimentary Website Audit</div>
                <h1>{a.businessName}</h1>
                <div className="audit-subject">
                  {a.location && <span>{a.location}</span>}
                  {a.website && <span>{a.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>}
                  {a.rating && <span className="star">★ {a.rating} Google rating</span>}
                </div>
                <p className="audit-verdict">
                  {a.rating ? <>You've earned a <b>{a.rating}★ reputation</b> the hard way. The trouble: your website isn't carrying it online — and it's quietly turning bookings away. Here's exactly what we found.</>
                    : <>We took a close look at your online presence. Here's what's working, what isn't, and where a stronger website would win you more clients.</>}
                </p>
              </div>
              {a.overall.score != null && (
                <div className="audit-grade">
                  <div className="audit-dial" style={{ ['--val' as string]: a.overall.score, ['--dial' as string]: sevColor[a.overall.severity] }}>
                    <div className="audit-dial-in"><div className="audit-dial-num">{a.overall.score}</div><div className="audit-dial-den">/ 100</div></div>
                  </div>
                  <div className="audit-glabel" style={{ color: sevColor[a.overall.severity] }}>{a.overall.label}</div>
                </div>
              )}
            </section>

            {/* Scorecard */}
            {a.tiles.length > 0 && (
              <section className="audit-band">
                <div className="audit-sechead"><h2>The Scorecard</h2></div>
                <div className="audit-cards">
                  {a.tiles.map((t) => (
                    <div className="audit-card" key={t.label}>
                      <div className="audit-ctop"><span className="audit-clabel">{t.label}</span><span className={`audit-pill ${t.severity}`}>{sevPillLabel[t.severity]}</span></div>
                      <div className="audit-cval">{t.value}{t.sub && <small> {t.sub}</small>}</div>
                      {t.meterPct != null && <div className={`audit-meter ${t.severity}`}><span style={{ width: `${t.meterPct}%` }} /></div>}
                      <div className="audit-cnote">{t.note}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Findings */}
            {a.findings.length > 0 && (
              <section className="audit-band">
                <div className="audit-sechead"><h2>What We Found</h2></div>
                <div className="audit-finds">
                  {a.findings.map((f, i) => (
                    <div className={`audit-find ${f.severity}`} key={i}>
                      <div className="audit-stripe" />
                      <div className="audit-fbody">
                        <div className="audit-ftop"><span className="audit-ftitle">{f.kicker}</span><span className={`audit-pill ${f.severity}`}>{sevPillLabel[f.severity]}</span></div>
                        <p className="audit-fdesc">{f.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Voice of customer */}
            {a.voice && (
              <section className="audit-band">
                <div className="audit-voice">
                  <div className="qmark" aria-hidden="true">&rdquo;</div>
                  <div className="audit-eyebrow">From your reviews</div>
                  <blockquote>{a.voice}</blockquote>
                  <cite>— Drawn from your recent Google reviews</cite>
                </div>
              </section>
            )}

            {/* CTA */}
            <section className="audit-band">
              <div className="audit-cta">
                <div className="audit-eyebrow">Where we'd start</div>
                <h3>A fast, modern site that books clients while you work.</h3>
                <p>{firstName ? `${firstName}, the` : 'The'} reputation is already there — the website just needs to catch up. We build sites that load in seconds, look effortless on a phone, rank in local search, and turn visitors into booked appointments. This audit is yours to keep, no strings.</p>
                <div className="audit-ctarow">
                  <a className="audit-btn" href={`mailto:${brand.contactEmail}`}>Book a 15-minute call →</a>
                  <div className="audit-contact"><b>{brand.name}</b><br />{brand.contactEmail} · {brand.contactPhone}</div>
                </div>
              </div>
            </section>
          </div>

          <footer className="audit-foot">
            <span>Prepared by {brand.name} for {a.businessName}</span>
            <span>Complimentary audit · {new Date().toLocaleDateString('en-CA')}</span>
          </footer>
        </article>
      </div>
    </div>
  )
}
