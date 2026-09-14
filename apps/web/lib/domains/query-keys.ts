export const queryKeys = {
  overview: ["overview"] as const,
  auth: {
    session: ["auth", "session"] as const,
    capabilities: ["auth", "capabilities"] as const,
  },
  users: {
    list: ["admin", "users"] as const,
  },
  series: {
    list: ["series", "list"] as const,
    detail: (seriesId: string) => ["series", "detail", seriesId] as const,
    capabilities: (seriesId: string) =>
      ["series", "capabilities", seriesId] as const,
    responsibleCandidates: (seriesId: string) =>
      ["series", "responsible-candidates", seriesId] as const,
    chapters: (seriesId: string) => ["series", seriesId, "chapters"] as const,
  },
  chapters: {
    list: ["chapters", "list"] as const,
    detail: (chapterId: string) => ["chapters", "detail", chapterId] as const,
    capabilities: (chapterId: string) =>
      ["chapters", "capabilities", chapterId] as const,
    helpers: (chapterId: string) => ["chapters", chapterId, "helpers"] as const,
    helperCandidates: (chapterId: string) =>
      ["chapters", chapterId, "helper-candidates"] as const,
    replacement: (chapterId: string, replacementId: string) =>
      ["chapters", chapterId, "replacements", replacementId] as const,
  },
  ingestion: {
    batch: (batchId: string) => ["ingestion", "batch", batchId] as const,
  },
  publication: {
    chapter: (chapterId: string) => ["public", "chapters", chapterId] as const,
  },
  discord: {
    authorizationConfiguration: [
      "admin",
      "discord",
      "authorized-roles",
    ] as const,
  },
  authorizations: {
    all: ["authorizations"] as const,
    mine: (status?: string) =>
      ["authorizations", "mine", status ?? "all"] as const,
    admin: (status?: string) =>
      ["authorizations", "admin", status ?? "all"] as const,
  },
} as const;
