import type { Permission } from "../../../authorization/domain/permissions.js";
import { resolveOverviewVisibility } from "../policies/overview-visibility.policy.js";
import type {
  OverviewReadModel,
  OverviewReadPort,
} from "../ports/overview-read.port.js";

export class GetOverviewQuery {
  constructor(private readonly overview: OverviewReadPort) {}

  async execute(input: {
    capabilities: readonly Permission[];
  }): Promise<OverviewReadModel> {
    const visibility = resolveOverviewVisibility(input.capabilities);
    const [totals, storage, activity7d, recentActivity] = await Promise.all([
      this.overview.getTotals(),
      this.overview.getStorageUsage(),
      this.overview.getActivity7d(),
      visibility.canViewRecentActivity
        ? this.overview.getRecentActivity(5)
        : Promise.resolve([]),
    ]);

    return {
      totals: {
        ...totals,
        activeUsers: visibility.canViewActiveUsers ? totals.activeUsers : null,
      },
      recentActivity,
      system: {
        // This only reflects the Overview read dependencies used by this query.
        overallStatus: "operational",
        storage,
        activity7d,
      },
    };
  }
}
