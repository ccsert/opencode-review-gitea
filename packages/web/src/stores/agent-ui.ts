import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AgentUIState {
  isOpen: boolean
  sidebarWidth: number
  toggle: () => void
  setOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
}

export const useAgentUIStore = create<AgentUIState>()(
  persist(
    (set) => ({
      isOpen: false,
      sidebarWidth: 420,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
    }),
    {
      name: 'agent-ui-storage',
      partialize: (state) => ({ sidebarWidth: state.sidebarWidth }),
    }
  )
)
