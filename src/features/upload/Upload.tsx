import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { AlertCircle, Check, FileSpreadsheet, FileUp, X } from 'lucide-react'
import { templatesApi } from '../../api/endpoints'
import { normalizeError } from '../../api/client'
import { useCan } from '../../components/rbac/Can'
import { Button, Card, Label } from '../../components/ui/primitives'
import { EmptyState, LoadingState } from '../../components/feedback'
import { PageHeader } from '../shared/bits'
import { cn } from '../../lib/utils'
import type { ImportResult, LeadTemplate } from '../../api/types'

interface ParsedSheet {
  fileName: string
  headers: string[]
  rows: Record<string, string>[]
}

export function UploadPage() {
  const canUpload = useCan('create', 'upload')
  const [params] = useSearchParams()
  const { data: templates, isLoading } = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list, enabled: canUpload })

  const [templateId, setTemplateId] = useState<string>(params.get('template') ?? '')
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const template: LeadTemplate | undefined = useMemo(
    () => templates?.find((t) => t.id === templateId),
    [templates, templateId],
  )

  const importMut = useMutation({
    mutationFn: () => templatesApi.import(templateId, { headers: sheet!.headers, rows: sheet!.rows, file_name: sheet!.fileName }),
    onSuccess: (res) => {
      setResult(res)
      if (res.imported > 0) toast.success(`Imported ${res.imported} lead${res.imported === 1 ? '' : 's'}`)
      if (res.rejected.length > 0) toast.warning(`${res.rejected.length} row${res.rejected.length === 1 ? '' : 's'} rejected`)
    },
    onError: (e) => toast.error(normalizeError(e).message),
  })

  async function handleFile(file: File) {
    setParseError(null)
    setResult(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) throw new Error('The file has no sheets.')
      // header:1 → array-of-arrays so we read the exact header row verbatim.
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false, raw: false })
      if (aoa.length === 0) throw new Error('The sheet is empty.')
      const headers = (aoa[0] as unknown[]).map((h) => String(h ?? '')) // exact, untrimmed — matching is case-sensitive
      const rows = aoa.slice(1).map((arr) => {
        const row: Record<string, string> = {}
        headers.forEach((h, i) => {
          row[h] = String((arr as unknown[])[i] ?? '')
        })
        return row
      })
      setSheet({ fileName: file.name, headers, rows })
    } catch (e) {
      setSheet(null)
      setParseError(e instanceof Error ? e.message : 'Could not read this file.')
    }
  }

  if (!canUpload) {
    return <EmptyState icon={FileUp} title="No access" message="Uploading leads is done by lead generators and managers." />
  }
  if (isLoading) return <LoadingState />

  const noTemplates = (templates ?? []).length === 0

  // Case-sensitive header check for the selected template.
  const columnChecks = template?.columns.map((c) => ({ ...c, matched: sheet ? sheet.headers.includes(c.name) : false })) ?? []
  const missingRequired = columnChecks.filter((c) => c.required && !c.matched)
  const canImport = !!template && !!sheet && missingRequired.length === 0 && !importMut.isPending

  return (
    <div className="reveal max-w-3xl">
      <PageHeader title="Upload leads" subtitle="Pick a template, then upload an Excel or CSV sheet. Column headers must match the template exactly (case-sensitive)." />

      {noTemplates ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No templates yet"
          message="Create a template first — it defines the columns your sheet must contain."
          action={<Link to="/templates"><Button>Go to templates</Button></Link>}
        />
      ) : (
        <div className="space-y-5">
          {/* Step 1 — template */}
          <Card className="p-5">
            <Label htmlFor="tpl">1. Choose a template</Label>
            <select
              id="tpl"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value)
                setResult(null)
              }}
              className="h-9 w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">Select a template…</option>
              {templates!.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.columns.length} columns)</option>
              ))}
            </select>
            {template && (
              <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                Expected columns:{' '}
                {template.columns.map((c) => (
                  <span key={c.id} className="mr-1 font-mono">{c.name}{c.required ? '*' : ''}</span>
                ))}
              </p>
            )}
          </Card>

          {/* Step 2 — file */}
          <Card className={cn('p-5', !template && 'pointer-events-none opacity-50')}>
            <Label>2. Upload your sheet</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
              }}
            />
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <FileUp className="h-4 w-4" /> Choose file
              </Button>
              <span className="text-sm text-[var(--color-text-secondary)]">
                {sheet ? `${sheet.fileName} — ${sheet.rows.length} row${sheet.rows.length === 1 ? '' : 's'}` : 'No file selected'}
              </span>
            </div>
            {parseError && (
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-[var(--c-unverified)]">
                <AlertCircle className="h-4 w-4" /> {parseError}
              </p>
            )}
          </Card>

          {/* Step 3 — header match preview */}
          {template && sheet && (
            <Card className="p-5">
              <Label>3. Column match (case-sensitive)</Label>
              <ul className="divide-y divide-[var(--color-border)]">
                {columnChecks.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="font-mono">{c.name}{c.required && <span className="text-[var(--color-text-muted)]"> *</span>}</span>
                    {c.matched ? (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--c-verified)]"><Check className="h-4 w-4" /> Matched</span>
                    ) : (
                      <span className={cn('inline-flex items-center gap-1 text-[13px] font-medium', c.required ? 'text-[var(--c-unverified)]' : 'text-[var(--color-text-muted)]')}>
                        <X className="h-4 w-4" /> {c.required ? 'Missing (required)' : 'Not in sheet'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {missingRequired.length > 0 && (
                <p className="mt-2 flex items-center gap-1.5 rounded-[8px] bg-red-50 p-2.5 text-[13px] text-[var(--c-unverified-text)]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  Required column(s) not found with an exact name match. Check capitalisation and spacing in your sheet's header row.
                </p>
              )}
              {sheet.headers.some((h) => !template.columns.find((c) => c.name === h)) && (
                <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                  Extra sheet columns ignored: {sheet.headers.filter((h) => !template.columns.find((c) => c.name === h)).map((h) => <span key={h} className="mr-1 font-mono">{h || '(blank)'}</span>)}
                </p>
              )}

              <div className="mt-4 flex justify-end">
                <Button loading={importMut.isPending} disabled={!canImport} onClick={() => importMut.mutate()}>
                  Import {sheet.rows.length} row{sheet.rows.length === 1 ? '' : 's'}
                </Button>
              </div>
            </Card>
          )}

          {/* Result */}
          {result && (
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold">Import complete</h3>
                {result.imported > 0 && (
                  <Link to={`/leads/batch/${result.batch_id}`}><Button size="sm" variant="outline">View this batch</Button></Link>
                )}
              </div>
              <div className="mt-3 flex gap-6 text-sm">
                <div><span className="text-[24px] font-bold tabular-nums text-[var(--c-verified)]">{result.imported}</span><p className="text-[12px] text-[var(--color-text-muted)]">Imported</p></div>
                <div><span className="text-[24px] font-bold tabular-nums text-[var(--c-unverified)]">{result.rejected.length}</span><p className="text-[12px] text-[var(--color-text-muted)]">Rejected</p></div>
                <div><span className="text-[24px] font-bold tabular-nums">{result.total_rows}</span><p className="text-[12px] text-[var(--color-text-muted)]">Total rows</p></div>
              </div>
              {result.rejected.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-[13px] font-medium">Rejected rows</p>
                  <ul className="max-h-56 overflow-y-auto rounded-[8px] border border-[var(--color-border)] text-[13px]">
                    {result.rejected.map((r) => (
                      <li key={r.row} className="flex gap-3 border-b border-[var(--color-border)] px-3 py-1.5 last:border-0">
                        <span className="shrink-0 font-mono text-[var(--color-text-muted)]">Row {r.row}</span>
                        <span className="text-[var(--color-text-secondary)]">{r.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
