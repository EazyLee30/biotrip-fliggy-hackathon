export type MemoryScope = "global" | "journey" | "day";
export type MemoryItem = {
  id: string;
  undoId?: string;
  note: string;
  category: string;
  scope: MemoryScope;
  journeyId: string | null;
  expiresOn: string | null;
  enabled: boolean;
  source: string;
  sourceId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type MemoryInput = {
  note: string;
  category?: string;
  scope: MemoryScope;
  journeyId?: string | null;
  expiresOn?: string | null;
  enabled?: boolean;
};
