// 0-false-positive honesty check: replay the deployed rules-skip against the newest batch's
// 13 imported (weak) leads. Any SKIP here = the rule would have cost a real lead.
import { analyzeWebsite } from './supabase/functions/pipeline-run/_website.ts'

const INFERRED = new Set(['Embedded form/scheduler', 'Booking link', 'Contact/appointment page', 'On-page form', 'Contact/booking CTA', 'Embedded/custom booking', 'Booking/contact found on rendered page'])
const soft = (i: string) => i.startsWith('No Instagram or Facebook') || i.startsWith('Built on ')

const IMPORTED: Array<[string, string]> = [
  ['Beam Beauty', 'https://www.beambeauty.ca/'],
  ['Clinique Laser-Esthetique', 'http://www.laseresthetique.com/'],
  ['Dermka Clinic', 'https://dermkaclinik.com/'],
  ['Dr. Anna Medical', 'https://drannamd.com/'],
  ['Ekinoxe Esthetique', 'https://cliniqueekinoxe.ca/'],
  ['EM Medecine Esthetique', 'http://emmedecineesthetique.com/'],
  ['Heaven The Spa', 'https://www.heavenspa.ca/'],
  ['La Deesse Cosmetic', 'https://www.ldmediclinic.com/'],
  ['La Peau Dor', 'http://www.lapeaudor.com/'],
  ['Medicart Quebec', 'https://medicart.com/clinique/medicart-quebec/'],
  ['My Beauty Secrets', 'https://mybeautysecretsvictoria.ca/'],
  ['Sunshine Cosmetic Clinic', 'https://sunshinemedispa.com/mississauga/'],
  ['Viva Clinic', 'http://www.cliniqueviva.com/'],
]

let skips = 0
for (const [name, url] of IMPORTED) {
  try {
    const w = await analyzeWebsite(url)
    const certainGood = !!(w.reachable && w.hasBookingWidget && w.bookingPlatform
      && !INFERRED.has(w.bookingPlatform) && w.hasMobileViewport
      && w.detectedIssues.every(soft) && w.chainSignals.length === 0)
    if (certainGood) skips++
    const hard = w.detectedIssues.filter((i) => !soft(i))
    const why = certainGood ? '' : ` [${!w.reachable ? 'unreachable/challenge' : !w.hasBookingWidget ? 'no booking' : INFERRED.has(w.bookingPlatform!) ? 'inferred: ' + w.bookingPlatform : !w.hasMobileViewport ? 'no viewport' : w.chainSignals.length ? 'CHAIN: ' + w.chainSignals[0].slice(0, 40) : 'hard: ' + hard.map((i) => i.split(' — ')[0]).join(' | ').slice(0, 80)}]`
    console.log(`${certainGood ? '!! SKIP !!      ' : 'AI-SCORED (ok) '} ${name.padEnd(26)}${why}`)
  } catch (e) { console.log(`ERROR           ${name}: ${(e as Error).message}`) }
}
console.log(`\nFALSE POSITIVES: ${skips}/13 ${skips === 0 ? '— rule is honest ✓' : '— RULE WOULD LOSE REAL LEADS ✗'}`)
