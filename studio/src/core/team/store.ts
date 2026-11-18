import { create } from 'zustand';

interface TeamState {
  workspace: { id: string; name: string } | null;
  loaded: boolean;
  refresh: () => Promise<void>;
}

/** No shared cloud workspaces in Studio; projects live in your OpenLeads workspace. */
export const useTeamStore = create<TeamState>(() => ({
  workspace: null,
  loaded: true,
  refresh: async () => {},
}));
