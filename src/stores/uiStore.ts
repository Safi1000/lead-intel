import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  sidebarCollapsed: boolean
  compactTables: boolean // density toggle (§3.5)
  theme: 'light' | 'dark'
  toggleSidebar: () => void
  setCompact: (v: boolean) => void
  toggleTheme: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      compactTables: false,
      theme: 'light',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
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
