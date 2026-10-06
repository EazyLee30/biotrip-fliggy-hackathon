import type { Journey, JourneyDraft } from "@/lib/journey-types";
import { journeyMachine } from "./machine";

type Context = { alive: boolean; session: number; journey: Journey | null };
export type DraftSnapshot = { title: string; draft: JourneyDraft };
export function draftFingerprint(value: unknown): string {
  return JSON.stringify(value, (_, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
}

/** One account's writes run in order, using the latest version at execution time. */
export function createDraftSaveQueue({ context, persist, onSaved }: {
  context: () => Context;
  persist: (target: Journey | null, snapshot: DraftSnapshot) => Promise<Journey>;
  onSaved: (journey: Journey, selected: boolean) => void;
}) {
  let pending: Promise<Journey | null> = Promise.resolve(null);
  return {
    save(snapshot: DraftSnapshot): Promise<Journey | null> {
      const session = context().session;
      const fingerprint = draftFingerprint(snapshot);
      const operation = pending.catch(() => null).then(async () => {
        const before = context();
        if (!before.alive || before.session !== session) return null;
        const target = before.journey;
        if (target && !journeyMachine(target).can.canEdit) return target;
        // Compare with the current record, never with a historical save receipt.
        if (target && draftFingerprint({ title: target.title, draft: target.draft }) === fingerprint) return target;
        const saved = await persist(target, snapshot);
        const after = context();
        if (!after.alive) return null;
        const selected = after.session === session && (target
          ? after.journey?.id === target.id
          : after.journey === null || after.journey.id === saved.id);
        onSaved(saved, selected);
        return selected ? saved : null;
      });
      pending = operation;
      return operation;
    },
  };
}
