import type { JourneyDraft, Journey } from "@/lib/journey-types";
import type { ItineraryOperation } from "@/lib/itinerary-edit";
import type { MemoryItem, MemoryInput } from "./memory-types";
import type { VerifiedOffer } from "@/lib/travel-search-types";
import type { JourneyCollectionItem } from "@/lib/journey-collections";
export type AssistantBlock =
  | { type: "question"; id: string; title: string; input: "date" | "options"; options?: Array<{ label: string; value: string }>; min?: string }
  | { type: "offers"; title: string; offers: VerifiedOffer[] }
  | { type: "checklist"; title: string; items: JourneyCollectionItem[] }
  | { type: "difference"; title: string; changes: Array<{ before: string; after: string }> }
  | { type: "status"; title: string; detail?: string };
export type AgentToolCall = { name: string; arguments: Record<string, unknown> };
export type AgentToolResult = { name: string; status: "ok" | "error"; data: unknown };
export type AgentAction =
  | {
      type: "edit";
      journeyId: string;
      version: number;
      operations: ItineraryOperation[];
    }
  | { type: "create"; draft: JourneyDraft }
  | { type: "plan"; journeyId: string; version: number; draft: JourneyDraft }
  | {
      type: "consult";
      journeyId: string;
      version: number;
      instruction: string;
      tags: string[];
    }
  | {
      type: "restore";
      journeyId: string;
      version: number;
      restoreVersion: number;
    }
  | { type: "forget"; memoryId: string }
  | { type: "collection"; journeyId: string; version: number; operation: "add" | "check" | "remove"; kind?: "backlog" | "checklist"; items?: Array<{ title: string; detail?: string }>; id?: string; checked?: boolean }
  | { type: "checkin"; journeyId: string; version: number; fatigue: number; stress?: number | null; tags: string[] }
  | { type: "feedback"; journeyId: string; version: number; adjustmentId: string; feeling: "lighter" | "same" | "still_tired"; fatigue: number | null; stress: number | null; note: string };
export type ActionCard = {
  id: string;
  title: string;
  summary: string;
  action: AgentAction;
  state: "proposed" | "applying" | "applied" | "discarded" | "failed";
  requiresApproval?: boolean;
  result?: ActionResult;
  preview?: Array<{ before: string; after: string }>;
  verifiedSources?: string[];
  verifiedOffers?: VerifiedOffer[];
};
export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  card?: ActionCard;
  memories?: MemoryItem[];
  error?: string;
  blocks?: AssistantBlock[];
};
export type Conversation = {
  id: string;
  journeyId: string | null;
  title: string;
  updatedAt: string;
};
export type AgentAnswer = {
  reply: string;
  title?: string;
  summary?: string;
  action?: AgentAction | null;
  memories?: Array<MemoryInput & { key: string; replacesId?: string }>;
  blocks?: AssistantBlock[];
  tools?: AgentToolCall[];
};
export type ActionResult = {
  journey?: Journey;
  jobId?: string;
  forgotten?: boolean;
  notice?: string;
  state?: "applied" | "failed";
  collectionsChanged?: boolean;
  bodyChanged?: boolean;
};
