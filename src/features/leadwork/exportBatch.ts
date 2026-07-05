import * as XLSX from 'xlsx'
import type { ManualLead } from '../../api/types'

/**
 * Client-side batch export → Excel. Builds a clean, client-facing sheet from each lead's `data`
 * (the enrichment fields), ordered sensibly, dropping internal/empty columns. Runs entirely in the
 * browser via the already-bundled `xlsx` lib — no server, works on any batch (incl. archived).
 */

// Preferred column order; any other data keys are appended after these.
const PREFERRED = [
  'Business Name', 'Address', 'Phone', 'Website', 'Email', 'Email Verified',
  'Rating', 'SEO Score', 'Performance Score', 'Tech Stack', 'Website Status',
  'Running Google Ads', 'Business Hours',
  'Pain Points', 'Personalization Notes', 'Why This Status', 'Site Issue Note',
]
// Internal columns we don't want in a client-facing export. "Best Time to Call (PKT)" is in
// Pakistan time — meaningless to the US agencies these exports go to (the CRM still shows it).
const DROP = new Set(['Source', 'Search Query', 'Search Location', 'Best Time to Call (PKT)'])

export function exportLeadsToXlsx(leads: ManualLead[], fileBase: string): void {
  const seen = new Set<string>()
  const order: string[] = []
  for (const k of PREFERRED) { order.push(k); seen.add(k) }
  for (const l of leads) for (const k of Object.keys(l.data ?? {})) {
    if (!seen.has(k) && !DROP.has(k)) { seen.add(k); order.push(k) }
  }
  // Keep only columns that actually carry data in this batch.
  const cols = order.filter((c) => leads.some((l) => String(l.data?.[c] ?? '').trim() !== ''))

  const rows = leads.map((l) => {
    const row: Record<string, string> = {}
    for (const c of cols) row[c] = l.data?.[c] ?? ''
    return row
  })

  const ws = XLSX.utils.json_to_sheet(rows, { header: cols })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Leads')
  const safe = fileBase.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'batch'
  XLSX.writeFile(wb, `${safe}.xlsx`)
}
