export type OverviewTotals = {
  series: number;
  chapters: number;
  images: number;
  activeUsers: number | null;
};

export type OverviewActivityItem = {
  id: string;
  actor: { id: string | null; label: string };
  action: string;
  resourceType: string;
  resourceLabel: string | null;
  occurredAt: string;
};

export type OverviewStorageUsage = {
  usedBytes: number | null;
  quotaBytes: number | null;
  source: "database" | "provider" | "unavailable";
};

export type OverviewDailyActivity = {
  date: string;
  series: number;
  chapters: number;
};

export type OverviewReadModel = {
  totals: OverviewTotals;
  recentActivity: OverviewActivityItem[];
  system: {
    overallStatus: "operational" | "degraded" | "unknown";
    storage: OverviewStorageUsage;
    activity7d: OverviewDailyActivity[];
  };
};

export interface OverviewReadPort {
  getTotals(): Promise<OverviewTotals>;
  getRecentActivity(limit: number): Promise<OverviewActivityItem[]>;
  getStorageUsage(): Promise<OverviewStorageUsage>;
  getActivity7d(): Promise<OverviewDailyActivity[]>;
}
