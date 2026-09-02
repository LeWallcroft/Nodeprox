import type { Permission } from "../../domain/permissions.js";
import type { ResourceContext } from "../../domain/authorization.types.js";
import type { Role } from "../../domain/roles.js";
import type { ProductSettingValue } from "../../domain/product-settings.registry.js";

export interface AuthorizationRoleRepository {
  findRoleByUserId(userId: string): Promise<string | null>;
}

export interface AuthorizationAuditRepository {
  append(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    result?: "success" | "rejected" | "failed";
    reasonCode?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface AuthorizationConfigRepository {
  getHelperCooldownDays(): Promise<number>;
}

export interface ProductSettingsRepository {
  read(keys: readonly string[]): Promise<Map<string, ProductSettingValue>>;
  write(
    changes: Array<[string, ProductSettingValue]>,
    actorId: string,
  ): Promise<void>;
}

export interface ResourceAuthorizationPort {
  evaluate(
    userId: string,
    permission: Permission,
    resource: ResourceContext,
  ): Promise<boolean>;
}

export type ResolvedAuthorizationRole = Role | string;
