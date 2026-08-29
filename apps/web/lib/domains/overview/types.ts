export type OverviewActivity = {
  id: string;
  actor: { id: string | null; label: string };
  action: string;
  resourceType: string;
  resourceLabel: string | null;
  occurredAt: string;
};

export type OverviewDailyActivity = {
  date: string;
  series: number;
  chapters: number;
};

export type OverviewReadModel = {
  totals: {
    series: number;
    chapters: number;
    images: number;
    activeUsers: number | null;
  };
  recentActivity: OverviewActivity[];
  system: {
    overallStatus: "operational" | "degraded" | "unknown";
    storage: {
      usedBytes: number | null;
      quotaBytes: number | null;
      source: "database" | "provider" | "unavailable";
    };
    activity7d: OverviewDailyActivity[];
  };
};
