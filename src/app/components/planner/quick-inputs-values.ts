export function uniquePhrases(phrases: readonly string[]): string[] {
  return [...new Set(phrases)].filter((phrase) => phrase.trim().length > 0);
}

export function hasExactPhrase(value: string, phrase: string): boolean {
  return value.split(/\r?\n/).includes(phrase);
}

/** Whole lines are toggled without treating similar free text as a match. */
export function toggleExactPhrase(value: string, phrase: string, maxLength?: number): string {
  if (!phrase.trim()) return value;
  if (hasExactPhrase(value, phrase)) return value.split(/\r?\n/).filter((line) => line !== phrase).join("\n");
  const next = `${value}${value && !value.endsWith("\n") ? "\n" : ""}${phrase}`;
  return maxLength !== undefined && next.length > maxLength ? value : next;
}
