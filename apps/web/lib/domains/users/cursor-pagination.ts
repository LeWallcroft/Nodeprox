export type CursorPageHistory = readonly (string | null)[];

export const initialCursorPageHistory: CursorPageHistory = [null];

export function advanceCursorPageHistory(
  history: CursorPageHistory,
  nextCursor: string | null,
): CursorPageHistory {
  if (!nextCursor || history.at(-1) === nextCursor) return history;
  return [...history, nextCursor];
}

export function retreatCursorPageHistory(
  history: CursorPageHistory,
): CursorPageHistory {
  return history.length > 1 ? history.slice(0, -1) : history;
}

export function currentPageCursor(history: CursorPageHistory): string | null {
  return history.at(-1) ?? null;
}
