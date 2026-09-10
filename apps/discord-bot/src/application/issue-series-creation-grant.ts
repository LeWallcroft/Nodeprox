import type {
  IssueSeriesCreationGrantInput,
  NodeProxDiscordApi,
} from "../infrastructure/nodeprox-api/contracts.js";

export class IssueSeriesCreationGrant {
  constructor(private readonly api: NodeProxDiscordApi) {}

  execute(input: IssueSeriesCreationGrantInput) {
    return this.api.issueSeriesCreationGrant(input);
  }
}
