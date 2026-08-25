export const queryKeys = {
  auth: {
    session: ["auth", "session"] as const,
    capabilities: ["auth", "capabilities"] as const,
  },
  series: {
    list: ["series", "list"] as const,
    detail: (seriesId: string) => ["series", "detail", seriesId] as const,
    chapters: (seriesId: string) => ["series", seriesId, "chapters"] as const,
  },
  chapters: {
    detail: (chapterId: string) => ["chapters", "detail", chapterId] as const,
  },
  publication: {
    chapter: (chapterId: string) => ["public", "chapters", chapterId] as const,
  },
} as const;
