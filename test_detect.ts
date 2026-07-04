// End-to-end: real site → analyzeWebsite (with excerpt) → scorePlace → final output.
import { readFileSync } from 'node:fs'
import { analyzeWebsite } from './supabase/functions/pipeline-run/_website.ts'
import { scorePlace } from './supabase/functions/pipeline-run/_ai.ts'

const env = readFileSync('.env', 'utf8')
const OPENAI = (env.match(/^OPENAI_API_KEY=(.+)/m) || [])[1].trim().replace(/^["']|["']$/g, '')

// Retief: the classic weak lead (2019 copyright, no email, Squarespace) — excerpt should ground hooks.
const ws = await analyzeWebsite('https://www.retiefskincenter.com/')
console.log('--- analyzeWebsite ---')
console.log('excerpt chars:', ws.visibleTextExcerpt?.length ?? 0)
console.log('excerpt sample:', (ws.visibleTextExcerpt ?? '').slice(0, 180))
console.log('issues:', ws.detectedIssues.length)

const { score } = await scorePlace({
  name: 'Retief Skin Center',
  address: 'Nashville, TN, USA',
  phone: '+1 615 555 0100',
  website: 'https://www.retiefskincenter.com/',
  rating: 4.8,
  businessType: 'skin_care_clinic',
  reviews: [
    { text: 'Dr. Retief is wonderful, my skin has never looked better after the laser treatments.', rating: 5 },
    { text: 'Great results but I had to call three times before anyone picked up to schedule.', rating: 4 },
    { text: 'Very professional staff, love the results.', rating: 5 },
  ],
  email: null,
  websiteSignals: ws,
}, 6, 'gpt-4o-mini', OPENAI)

console.log('\n--- scorePlace ---')
console.log(`ws=${score.website_status} q=${score.quality_score} low_fit=${score.low_fit} conf=${score.confidence} niche=${score.is_correct_niche}`)
console.log('status_reason:', score.status_reason)
console.log('site_issue_note:', score.site_issue_note)
console.log('pain_points:', score.pain_points)
console.log('personalization:', score.personalization_notes)
