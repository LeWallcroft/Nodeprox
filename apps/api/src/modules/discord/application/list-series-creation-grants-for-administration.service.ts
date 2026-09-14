import { and, desc, eq, lt, or } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import {
  seriesCreationGrants,
  users,
} from "../../../../../../database/schema/index.js";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../authorization/domain/permissions.js";
import type { GrantStatus } from "./discord-gateway.service.js";

type Cursor = { issuedAt: string; id: string };

export class DiscordGrantAdministrationForbiddenError extends Error {}
export class DiscordGrantAdministrationValidationError extends Error {}

export class ListSeriesCreationGrantsForAdministrationService {
  constructor(
    private readonly db: NodeProxDatabase,
    private readonly authorization: AuthorizationService,
  ) {}

  async execute(
    actor: AuthorizationContext,
    input: {
      status?: GrantStatus | undefined;
      targetUserId?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ) {
    const decision = await this.authorization.authorize(
      actor,
      PERMISSIONS.DISCORD_SERIES_GRANT_READ,
    );
    if (!decision.allowed) throw new DiscordGrantAdministrationForbiddenError();
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    const where = [
      ...(input.status ? [eq(seriesCreationGrants.status, input.status)] : []),
      ...(input.targetUserId
        ? [eq(seriesCreationGrants.targetUserId, input.targetUserId)]
        : []),
      ...(cursor
        ? [
            or(
              lt(seriesCreationGrants.issuedAt, new Date(cursor.issuedAt)),
              and(
                eq(seriesCreationGrants.issuedAt, new Date(cursor.issuedAt)),
                lt(seriesCreationGrants.id, cursor.id),
              ),
            ),
          ]
        : []),
    ];
    const rows = await this.db
      .select({
        id: seriesCreationGrants.id,
        displayCode: seriesCreationGrants.displayCode,
        reference: seriesCreationGrants.reference,
        status: seriesCreationGrants.status,
        issuedAt: seriesCreationGrants.issuedAt,
        targetUserId: users.id,
        targetDisplayName: users.email,
      })
      .from(seriesCreationGrants)
      .innerJoin(users, eq(users.id, seriesCreationGrants.targetUserId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(
        desc(seriesCreationGrants.issuedAt),
        desc(seriesCreationGrants.id),
      )
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        displayCode: row.displayCode,
        reference: row.reference,
        status: row.status,
        issuedAt: row.issuedAt.toISOString(),
        targetUser: {
          id: row.targetUserId,
          displayName: row.targetDisplayName,
        },
      })),
      nextCursor:
        rows.length > input.limit && last
          ? encodeCursor({ issuedAt: last.issuedAt.toISOString(), id: last.id })
          : null,
    };
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed?.issuedAt !== "string" ||
      Number.isNaN(new Date(parsed.issuedAt).getTime()) ||
      typeof parsed?.id !== "string"
    )
      throw new Error("invalid cursor");
    return { issuedAt: parsed.issuedAt, id: parsed.id };
  } catch {
    throw new DiscordGrantAdministrationValidationError();
  }
}
