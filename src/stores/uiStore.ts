import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  sidebarCollapsed: boolean
  collapsedSections: string[] // nav section headings the user has collapsed
  compactTables: boolean // density toggle (§3.5)
  theme: 'light' | 'dark'
  toggleSidebar: () => void
  toggleSection: (section: string) => void
  setCompact: (v: boolean) => void
  toggleTheme: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      collapsedSections: [],
      compactTables: false,
      theme: 'light',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleSection: (section) =>
        set((s) => ({
          collapsedSections: s.collapsedSections.includes(section)
            ? s.collapsedSections.filter((x) => x !== section)
            : [...s.collapsedSections, section],
        })),
      setCompact: (v) => set({ compactTables: v }),
      toggleTheme: () =>
        set((s) => {
          const theme = s.theme === 'light' ? 'dark' : 'light'
          document.documentElement.classList.toggle('dark', theme === 'dark')
          return { theme }
        }),
    }),
    { name: 'leadintel-ui' },
  ),
)
