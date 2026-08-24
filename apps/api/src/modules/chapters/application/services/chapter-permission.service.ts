import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { AuthorizationService } from "../../../authorization/application/services/authorization.service.js";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import type { AuthorizationAuditRepository } from "../../../authorization/application/ports/authorization.ports.js";
import {
  isDelegableChapterPermission,
  type DelegableChapterPermission,
} from "../../domain/chapter-permission.policy.js";
import type { Permission } from "../../../authorization/domain/permissions.js";
import type {
  ChapterPermissionRepositoryPort,
  ChapterRepositoryPort,
  ChapterUserPort,
} from "../ports/chapter.ports.js";

export type ChapterPermissionResult =
  | { allowed: true; reason: "owner" | "helper" | "role"; seriesId: string }
  | {
      allowed: false;
      reason: "unauthenticated" | "not-found" | "denied" | "policy-error";
    };

export class ChapterPermissionService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly chapters: ChapterRepositoryPort,
    private readonly users: ChapterUserPort,
    private readonly permissions: ChapterPermissionRepositoryPort,
    private readonly audit: AuthorizationAuditRepository,
  ) {}

  async grant(input: {
    context: AuthorizationContext;
    chapterId: string;
    helperUserId: string;
    permissions: readonly string[];
  }): Promise<
    | { count: number }
    | { conflict: "cooldown" | "already-granted" }
    | { denied: true }
    | { notFound: true }
  > {
    const actor = await this.resolveManager(
      input.context,
      input.chapterId,
      PERMISSIONS.CHAPTERS_HELPER_GRANT,
    );
    if (!actor.allowed) {
      await this.recordDenied(
        input.context.userId,
        "chapter.permission.grant.denied",
        input.chapterId,
      );
      return actor.reason === "not-found"
        ? { notFound: true }
        : { denied: true };
    }
    if (!(await this.users.existsById(input.helperUserId)))
      return { notFound: true };
    const delegable = input.permissions.map((permission) => {
      if (!isDelegableChapterPermission(permission))
        throw new InvalidChapterPermissionError();
      return permission;
    });
    if (new Set(delegable).size !== delegable.length || delegable.length === 0)
      throw new InvalidChapterPermissionError();
    const cooldown = await this.authorization.getHelperCooldownDecision();
    if (!cooldown.allowed) {
      await this.recordDenied(
        input.context.userId,
        "chapter.permission.grant.denied",
        input.chapterId,
      );
      return { denied: true };
    }
    const result = await this.permissions.grant({
      chapterId: input.chapterId,
      helperUserId: input.helperUserId,
      grantedBy: input.context.userId,
      permissions: delegable,
      cooldownDays: cooldown.days,
      now: new Date(),
    });
    if (result.outcome === "granted") return { count: result.count };
    await this.recordDenied(
      input.context.userId,
      "chapter.permission.grant.denied",
      input.chapterId,
    );
    return { conflict: result.reason };
  }

  async revoke(input: {
    context: AuthorizationContext;
    chapterId: string;
    helperUserId: string;
  }): Promise<{ count: number } | { denied: true } | { notFound: true }> {
    const actor = await this.resolveManager(
      input.context,
      input.chapterId,
      PERMISSIONS.CHAPTERS_HELPER_REVOKE,
    );
    if (!actor.allowed) {
      await this.recordDenied(
        input.context.userId,
        "chapter.permission.revoke.denied",
        input.chapterId,
      );
      return actor.reason === "not-found"
        ? { notFound: true }
        : { denied: true };
    }
    const result = await this.permissions.revoke({
      chapterId: input.chapterId,
      helperUserId: input.helperUserId,
      revokedBy: input.context.userId,
      now: new Date(),
    });
    return result;
  }

  async check(input: {
    context: AuthorizationContext;
    chapterId: string;
    permission: string;
  }): Promise<ChapterPermissionResult> {
    if (!input.context.userId || !input.context.sessionId)
      return { allowed: false, reason: "unauthenticated" };
    try {
      const chapter = await this.chapters.findById(input.chapterId);
      if (!chapter) return { allowed: false, reason: "not-found" };
      if (!isDelegableChapterPermission(input.permission))
        return { allowed: false, reason: "denied" };
      const roleDecision = await this.authorization.authorize(
        input.context,
        input.permission as DelegableChapterPermission,
      );
      if (!roleDecision.allowed)
        return {
          allowed: false,
          reason:
            roleDecision.reason === "policy-error" ? "policy-error" : "denied",
        };
      if (roleDecision.role === "admin" || roleDecision.role === "gestor")
        return { allowed: true, reason: "role", seriesId: chapter.seriesId };
      if (chapter.createdBy === input.context.userId)
        return { allowed: true, reason: "owner", seriesId: chapter.seriesId };
      const helper = await this.permissions.hasActivePermission({
        chapterId: input.chapterId,
        helperUserId: input.context.userId,
        permission: input.permission as DelegableChapterPermission,
      });
      return helper
        ? { allowed: true, reason: "helper", seriesId: chapter.seriesId }
        : { allowed: false, reason: "denied" };
    } catch {
      return { allowed: false, reason: "policy-error" };
    }
  }

  async list(
    chapterId: string,
  ): Promise<
    Awaited<ReturnType<ChapterPermissionRepositoryPort["listActive"]>>
  > {
    return this.permissions.listActive(chapterId);
  }

  private async resolveManager(
    context: AuthorizationContext,
    chapterId: string,
    permission: Permission,
  ): Promise<
    { allowed: true } | { allowed: false; reason: "not-found" | "denied" }
  > {
    if (!context.userId || !context.sessionId)
      return { allowed: false, reason: "denied" };
    const chapter = await this.chapters.findById(chapterId);
    if (!chapter) return { allowed: false, reason: "not-found" };
    const decision = await this.authorization.authorize(context, permission);
    if (!decision.allowed) return { allowed: false, reason: "denied" };
    if (
      decision.role === "admin" ||
      decision.role === "gestor" ||
      chapter.createdBy === context.userId
    )
      return { allowed: true };
    return { allowed: false, reason: "denied" };
  }

  private async recordDenied(
    actorId: string | undefined,
    action: string,
    chapterId: string,
  ) {
    if (!actorId) return;
    await this.audit.append({
      actorId,
      action,
      resourceType: "chapter",
      resourceId: chapterId,
      metadata: { result: "denied" },
    });
  }
}

export class InvalidChapterPermissionError extends Error {
  constructor() {
    super("Chapter permission payload is invalid");
    this.name = "InvalidChapterPermissionError";
  }
}
