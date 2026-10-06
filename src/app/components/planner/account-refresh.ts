/** Refresh receipts are tied to a profile revision, so late reads cannot mark newer edits clean. */
export function createAccountRefresh<T>({ read, apply }: {
  read: () => Promise<T>; apply: (value: T) => void;
}) {
  let revision = 0, savedRevision = 0;
  return {
    changed() { revision++; },
    async refresh(alive: () => boolean): Promise<T | null> {
      if (!alive() || revision === savedRevision) return null;
      const started = revision;
      const value = await read();
      if (!alive()) return null;
      if (started !== revision) throw new Error("账户资料刚刚更新，请再试一次以读取最新内容。");
      apply(value); savedRevision = started;
      return value;
    },
  };
}
