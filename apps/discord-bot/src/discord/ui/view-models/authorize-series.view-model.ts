export type AuthorizeSeriesViewModel =
  | {
      state: "selecting-target";
      workflowId: string;
      initiatedByDiscordUserId: string;
    }
  | {
      state: "target-selected";
      workflowId: string;
      initiatedByDiscordUserId: string;
      targetDiscordId: string;
    }
  | {
      state: "pending-confirmation";
      workflowId: string;
      initiatedByDiscordUserId: string;
      targetDiscordId: string;
      reference: string | null;
    }
  | {
      state: "completed";
      initiatedByDiscordUserId: string;
      targetDiscordId: string;
      reference: string | null;
      displayCode: string;
    }
  | {
      state: "cancelled";
      initiatedByDiscordUserId: string;
    };
