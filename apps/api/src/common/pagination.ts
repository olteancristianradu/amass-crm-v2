/**
 * Cursor-based pagination helper. The cursor is the `id` of the last item
 * of the previous page (Prisma `cursor`+`skip:1` pattern). We always sort
 * by `createdAt desc, id desc` for stable ordering.
 */
export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export function buildCursorArgs(cursor: string | undefined, limit: number) {
  return {
    take: limit + 1, // fetch one extra to know if there's a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  };
}

export function makeCursorPage<T extends { id: string }>(items: T[], limit: number): CursorPage<T> {
  if (items.length > limit) {
    const data = items.slice(0, limit);
    return { data, nextCursor: data[data.length - 1].id };
  }
  return { data: items, nextCursor: null };
}
