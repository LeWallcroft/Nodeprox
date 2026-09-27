import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { AuthorizationService } from "../../../authorization/application/services/authorization.service.js";
import type {
  ChapterAuthorizationFailureCode,
  ChapterTechnicalFailure,
} from "../chapter-authorization-result.js";
import type { ChapterAuthorizationFailureReporter } from "../ports/chapter-authorization-failure-reporter.port.js";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import type { AuthorizationAuditRepository } from "../../../authorization/application/ports/authorization.ports.js";
import {
  evaluateChapterAdministrationAuthorization,
  evaluateChapterContextualAuthorization,
  isDelegableChapterPermission,
  type DelegableChapterPermission,
} from "../../domain/chapter-permission.policy.js";
import { evaluateChapterDelete } from "../../domain/chapter-delete.policy.js";
import type { Permission } from "../../../authorization/domain/permissions.js";
import type {
  ChapterPermissionRepositoryPort,
  ChapterRepositoryPort,
  ChapterUserPort,
} from "../ports/chapter.ports.js";

export type ChapterPermissionResult =
  | {
      allowed: true;
      reason: "helper" | "assigned" | "role";
      seriesId: string;
    }
  | {
      allowed: false;
      reason: "unauthenticated" | "not-found" | "denied";
    }
  | ChapterTechnicalFailure;

export class ChapterPermissionService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly chapters: ChapterRepositoryPort,
    private readonly users: ChapterUserPort,
    private readonly permissions: ChapterPermissionRepositoryPort,
    private readonly audit: AuthorizationAuditRepository,
    private readonly failures?: ChapterAuthorizationFailureReporter,
  ) {}

  async grant(input: {
    context: AuthorizationContext;
    chapterId: string;
    helperUserId: string;
    permissions: readonly string[];
    requestId?: string;
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
      if (actor.reason !== "authorization-unavailable")
        await this.recordDenied(
          input.context.userId,
          "chapter.permission.grant.denied",
          input.chapterId,
          "forbidden",
          input.requestId,
        );
      return actor.reason === "not-found"
        ? { notFound: true }
        : { denied: true };
    }
    const helper = this.users.findUserById
      ? await this.users.findUserById(input.helperUserId)
      : (await this.users.existsById(input.helperUserId))
        ? {
            id: input.helperUserId,
            status: "active",
            role: "uploader" as const,
          }
        : null;
    if (!helper) return { notFound: true };
    if (helper.status !== "active" || helper.role !== "uploader")
      return { denied: true };
    const delegable = input.permissions.map((permission) => {
      if (!isDelegableChapterPermission(permission))
        throw new InvalidChapterPermissionError();
      return permission;
    });
    if (new Set(delegable).size !== delegable.length || delegable.length === 0)
      throw new InvalidChapterPermissionError();
    const cooldown = await this.authorization.getHelperCooldownDecision();
    if (!cooldown.allowed) return { denied: true };
    const result = await this.permissions.grant({
      actor: input.context,
      chapterId: input.chapterId,
      helperUserId: input.helperUserId,
      permissions: delegable,
      cooldownDays: cooldown.days,
      now: new Date(),
    });
    if (result.outcome === "granted") return { count: result.count };
    if (result.outcome === "not-found") return { notFound: true };
    if (result.outcome === "denied") return { denied: true };
    await this.recordDenied(
      input.context.userId,
      "chapter.permission.grant.denied",
      input.chapterId,
      "chapter-permission-conflict",
      input.requestId,
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
      if (actor.reason !== "authorization-unavailable")
        await this.recordDenied(
          input.context.userId,
          "chapter.permission.revoke.denied",
          input.chapterId,
          "forbidden",
        );
      return actor.reason === "not-found"
        ? { notFound: true }
        : { denied: true };
    }
    const cooldown = await this.authorization.getHelperCooldownDecision();
    if (!cooldown.allowed) return { denied: true };
    const result = await this.permissions.revokeIfAuthorized({
      actor: input.context,
      chapterId: input.chapterId,
      helperUserId: input.helperUserId,
      now: new Date(),
      cooldownDays: cooldown.days,
    });
    if (result.outcome === "not-found") return { notFound: true };
    if (result.outcome === "denied") return { denied: true };
    return { count: result.count };
  }

  async check(input: {
    context: AuthorizationContext;
    chapterId: string;
    permission: string;
  }): Promise<ChapterPermissionResult> {
    if (!input.context.userId || !input.context.sessionId)
      return { allowed: false, reason: "unauthenticated" };
    let chapter: Awaited<ReturnType<ChapterRepositoryPort["findById"]>>;
    try {
      chapter = await this.chapters.findById(input.chapterId);
    } catch (error) {
      return this.technicalFailure(
        "chapter-read-failed",
        "check",
        input.context,
        input.chapterId,
        input.permission,
        error,
      );
    }
    if (!chapter) return { allowed: false, reason: "not-found" };
    if (
      input.permission === PERMISSIONS.CHAPTERS_HELPER_GRANT ||
      input.permission === PERMISSIONS.CHAPTERS_HELPER_REVOKE
    ) {
      const manager = await this.resolveManager(
        input.context,
        input.chapterId,
        input.permission,
      );
      return manager.allowed
        ? {
            allowed: true,
            reason: manager.reason,
            seriesId: manager.seriesId,
          }
        : manager;
    }
    if (!isDelegableChapterPermission(input.permission))
      return { allowed: false, reason: "denied" };
    const roleDecision = await this.authorization.authorize(
      input.context,
      input.permission as DelegableChapterPermission,
    );
    if (!roleDecision.allowed) {
      if (roleDecision.reason === "authorization-unavailable")
        return roleDecision;
      return {
        allowed: false,
        reason: "denied",
      };
    }
    let owner = false;
    if (roleDecision.role === "gestor" && this.chapters.isSeriesOwner) {
      try {
        owner = await this.chapters.isSeriesOwner(
          chapter.seriesId,
          input.context.userId,
        );
      } catch (error) {
        return this.technicalFailure(
          "series-owner-evaluation-failed",
          "check",
          input.context,
          input.chapterId,
          input.permission,
          error,
        );
      }
    }
    let isAssigned = false;
    if (roleDecision.role === "uploader" && this.chapters.isAssigned) {
      try {
        isAssigned = await this.chapters.isAssigned(
          chapter.seriesId,
          input.context.userId,
        );
      } catch (error) {
        return this.technicalFailure(
          "series-assignment-evaluation-failed",
          "check",
          input.context,
          input.chapterId,
          input.permission,
          error,
        );
      }
    }
    const contextualReason = evaluateChapterContextualAuthorization({
      role: roleDecision.role,
      isSeriesOwner: owner,
      isAssigned,
      hasHelperPermission: false,
    });
    if (contextualReason)
      return {
        allowed: true,
        reason: contextualReason,
        seriesId: chapter.seriesId,
      };
    let hasHelperPermission: boolean;
    try {
      hasHelperPermission = await this.permissions.hasActivePermission({
        chapterId: input.chapterId,
        helperUserId: input.context.userId,
        permission: input.permission as DelegableChapterPermission,
      });
    } catch (error) {
      return this.technicalFailure(
        "helper-permission-evaluation-failed",
        "check",
        input.context,
        input.chapterId,
        input.permission,
        error,
      );
    }
    const reason = evaluateChapterContextualAuthorization({
      role: roleDecision.role,
      isSeriesOwner: false,
      isAssigned: false,
      hasHelperPermission,
    });
    return reason
      ? { allowed: true, reason, seriesId: chapter.seriesId }
      : { allowed: false, reason: "denied" };
  }

  async projectCapabilities(context: AuthorizationContext, chapterId: string) {
    const capabilities: string[] = [];
    for (const permission of [
      PERMISSIONS.CHAPTERS_READ,
      PERMISSIONS.CHAPTERS_EDIT,
      PERMISSIONS.CHAPTERS_REPLACE,
      PERMISSIONS.IMAGES_UPLOAD,
      PERMISSIONS.IMAGES_REPLACE,
      PERMISSIONS.IMAGES_REORDER,
      PERMISSIONS.IMAGES_DELETE,
      PERMISSIONS.CHAPTERS_HELPER_GRANT,
      PERMISSIONS.CHAPTERS_HELPER_REVOKE,
    ]) {
      const result = await this.check({ context, chapterId, permission });
      if (result.allowed) capabilities.push(permission);
    }

    let chapter: Awaited<ReturnType<ChapterRepositoryPort["findById"]>>;
    try {
      chapter = await this.chapters.findById(chapterId);
    } catch (error) {
      this.technicalFailure(
        "chapter-read-failed",
        "projectCapabilities",
        context,
        chapterId,
        PERMISSIONS.CHAPTERS_DELETE,
        error,
      );
      return { capabilities };
    }
    if (chapter) {
      const decision = await this.authorization.authorize(
        context,
        PERMISSIONS.CHAPTERS_DELETE,
      );
      if (decision.allowed) {
        let isOwner = false;
        if (decision.role === "gestor" && this.chapters.isSeriesOwner) {
          try {
            isOwner = await this.chapters.isSeriesOwner(
              chapter.seriesId,
              context.userId,
            );
          } catch (error) {
            this.technicalFailure(
              "series-owner-evaluation-failed",
              "projectCapabilities",
              context,
              chapterId,
              PERMISSIONS.CHAPTERS_DELETE,
              error,
            );
            return { capabilities };
          }
        }
        let isAssigned = false;
        if (decision.role === "uploader" && this.chapters.isAssigned) {
          try {
            isAssigned = await this.chapters.isAssigned(
              chapter.seriesId,
              context.userId,
            );
          } catch (error) {
            this.technicalFailure(
              "series-assignment-evaluation-failed",
              "projectCapabilities",
              context,
              chapterId,
              PERMISSIONS.CHAPTERS_DELETE,
              error,
            );
            return { capabilities };
          }
        }
        const deletePolicy = evaluateChapterDelete({
          actorRole: decision.role,
          permission: PERMISSIONS.CHAPTERS_DELETE,
          assigned: isAssigned,
          seriesOwner: isOwner,
        });
        if (deletePolicy.allowed)
          capabilities.push(PERMISSIONS.CHAPTERS_DELETE);
      }
    }
    return { capabilities };
  }

  async canReadContext(context: AuthorizationContext, chapterId: string) {
    const read = await this.check({
      context,
      chapterId,
      permission: PERMISSIONS.CHAPTERS_READ,
    });
    if (read.allowed) return read;
    if (read.reason === "authorization-unavailable") return read;
    if (!context.userId || !context.sessionId) return read;
    let chapter: Awaited<ReturnType<ChapterRepositoryPort["findById"]>>;
    try {
      chapter = await this.chapters.findById(chapterId);
    } catch (error) {
      return this.technicalFailure(
        "chapter-read-failed",
        "canReadContext",
        context,
        chapterId,
        PERMISSIONS.CHAPTERS_READ,
        error,
      );
    }
    if (!chapter)
      return { allowed: false as const, reason: "not-found" as const };
    let hasOperationalPermission: boolean;
    try {
      hasOperationalPermission = await this.permissions.hasAnyActivePermission({
        chapterId,
        helperUserId: context.userId,
      });
    } catch (error) {
      return this.technicalFailure(
        "helper-permission-evaluation-failed",
        "canReadContext",
        context,
        chapterId,
        PERMISSIONS.CHAPTERS_READ,
        error,
      );
    }
    return hasOperationalPermission
      ? {
          allowed: true as const,
          reason: "helper" as const,
          seriesId: chapter.seriesId,
        }
      : read;
  }

  async list(
    context: AuthorizationContext,
    chapterId: string,
  ): Promise<
    | {
        helpers: Array<{
          userId: string;
          email: string;
          permissions: string[];
          grantedAt: Date;
        }>;
      }
    | { denied: true }
    | { notFound: true }
  > {
    const grant = await this.check({
      context,
      chapterId,
      permission: PERMISSIONS.CHAPTERS_HELPER_GRANT,
    });
    const revoke = await this.check({
      context,
      chapterId,
      permission: PERMISSIONS.CHAPTERS_HELPER_REVOKE,
    });
    if (grant.reason === "not-found" && revoke.reason === "not-found")
      return { notFound: true };
    if (!grant.allowed && !revoke.allowed) return { denied: true };
    const records = await this.permissions.listActiveWithUsers(chapterId);
    const grouped = new Map<
      string,
      { userId: string; email: string; permissions: string[]; grantedAt: Date }
    >();
    for (const record of records) {
      const helper = grouped.get(record.helperUserId) ?? {
        userId: record.helperUserId,
        email: record.email,
        permissions: [],
        grantedAt: record.grantedAt,
      };
      helper.permissions.push(record.permission);
      grouped.set(record.helperUserId, helper);
    }
    return { helpers: [...grouped.values()] };
  }

  async listCandidates(context: AuthorizationContext, chapterId: string) {
    const grant = await this.check({
      context,
      chapterId,
      permission: PERMISSIONS.CHAPTERS_HELPER_GRANT,
    });
    if (grant.reason === "not-found") return { notFound: true as const };
    if (!grant.allowed) return { denied: true as const };
    return {
      candidates: await this.permissions.listEligibleCandidates(
        chapterId,
        new Date(),
      ),
    };
  }

  private async resolveManager(
    context: AuthorizationContext,
    chapterId: string,
    permission: Permission,
  ): Promise<
    | { allowed: true; reason: "role" | "assigned"; seriesId: string }
    | { allowed: false; reason: "not-found" | "denied" }
    | ChapterTechnicalFailure
  > {
    if (!context.userId || !context.sessionId)
      return { allowed: false, reason: "denied" };
    let chapter: Awaited<ReturnType<ChapterRepositoryPort["findById"]>>;
    try {
      chapter = await this.chapters.findById(chapterId);
    } catch (error) {
      return this.technicalFailure(
        "chapter-read-failed",
        "resolveManager",
        context,
        chapterId,
        permission,
        error,
      );
    }
    if (!chapter) return { allowed: false, reason: "not-found" };
    const decision = await this.authorization.authorize(context, permission);
    if (!decision.allowed) {
      if (decision.reason === "authorization-unavailable") return decision;
      return {
        allowed: false,
        reason: "denied",
      };
    }
    let isAssigned = false;
    if (decision.role === "uploader" && this.chapters.isAssigned) {
      try {
        isAssigned = await this.chapters.isAssigned(
          chapter.seriesId,
          context.userId,
        );
      } catch (error) {
        return this.technicalFailure(
          "series-assignment-evaluation-failed",
          "resolveManager",
          context,
          chapterId,
          permission,
          error,
        );
      }
    }
    const reason = evaluateChapterAdministrationAuthorization({
      role: decision.role,
      isAssigned,
    });
    return reason
      ? { allowed: true, reason, seriesId: chapter.seriesId }
      : { allowed: false, reason: "denied" };
  }

  private technicalFailure(
    failureCode: ChapterAuthorizationFailureCode,
    operation: string,
    context: AuthorizationContext,
    chapterId: string,
    permission: string,
    error?: unknown,
  ): ChapterTechnicalFailure {
    try {
      this.failures?.report({
        code: failureCode,
        operation,
        actorId: context.userId,
        permission,
        resourceType: "chapter",
        resourceId: chapterId,
        ...(error === undefined ? {} : { error }),
      });
    } catch {
      // Logging must not alter the fail-closed result.
    }
    return { allowed: false, reason: "authorization-unavailable", failureCode };
  }

  private async recordDenied(
    actorId: string | undefined,
    action: string,
    chapterId: string,
    reasonCode: string,
    requestId?: string,
  ) {
    if (!actorId) return;
    await this.audit.append({
      actorId,
      action,
      resourceType: "chapter",
      resourceId: chapterId,
      result: "rejected",
      reasonCode,
      ...(requestId ? { requestId } : {}),
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
