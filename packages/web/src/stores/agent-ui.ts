import { create } from 'zustand'

interface AgentUIState {
  isOpen: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
}

export const useAgentUIStore = create<AgentUIState>((set) => ({
  isOpen: false,
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (open) => set({ isOpen: open }),
}))
