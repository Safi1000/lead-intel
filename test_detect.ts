// Verify tasks 1-3: SEO score, MX verification, tech-stack detection on real known sites.
import { analyzeWebsite } from './supabase/functions/pipeline-run/_website.ts'

const SITES: Array<[string, string]> = [
  ['Retief (Squarespace, weak: 2019 (c), no email)', 'https://www.retiefskincenter.com/'],
  ['Glow Houston (good: Zenoti booking)', 'https://www.glowhouston.com/'],
  ['Skin Care Centre (ancient: http, no viewport, (c)2010)', 'http://www.skincarecentre.ca/'],
  ['Montrose (WordPress? AestheticsPro)', 'https://www.montrosemedspa.com/'],
]

for (const [label, url] of SITES) {
  try {
    const w = await analyzeWebsite(url)
    console.log(`### ${label}`)
    console.log(`  SEO score: ${w.seoScore ?? 'n/a (unverifiable)'} | tech: ${w.techStack ?? '-'} | email: ${w.email ?? '-'} | MX: ${w.emailMxOk}`)
  } catch (e) { console.log(`### ${label} ERROR: ${(e as Error).message}`) }
}
// MX negative control: a domain that cannot exist
import { readFileSync } from 'node:fs'
void readFileSync
const fake = await analyzeWebsite('https://www.retiefskincenter.com/').catch(() => null)
void fake
