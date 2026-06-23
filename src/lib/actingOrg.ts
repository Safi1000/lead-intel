/** The org an SA has "entered" (View). Pure client state, persisted locally. */
const KEY = 'leadintel.actingOrg'

export interface ActingOrg {
  id: string
  name: string
}

export function loadActingOrg(): ActingOrg | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ActingOrg) : null
  } catch {
    return null
  }
}
export function saveActingOrg(v: ActingOrg) {
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* ignore */ }
}
export function clearActingOrg() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
