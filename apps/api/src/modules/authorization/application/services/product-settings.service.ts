import type { AuthorizationContext } from "../../domain/authorization.types.js";
import { PERMISSIONS } from "../../domain/permissions.js";
import {
  findProductSettingDefinition,
  PRODUCT_SETTINGS_REGISTRY,
  type ProductSettingValue,
} from "../../domain/product-settings.registry.js";
import type {
  AuthorizationAuditRepository,
  ProductSettingsRepository,
} from "../ports/authorization.ports.js";
import type { AuthorizationService } from "./authorization.service.js";

export class ProductSettingsValidationError extends Error {}
export class ProductSettingsForbiddenError extends Error {}

export class ProductSettingsService {
  constructor(
    private readonly repository: ProductSettingsRepository,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuthorizationAuditRepository,
  ) {}

  private async requireManage(context: AuthorizationContext) {
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.ADMIN_SYSTEM_MANAGE,
    );
    if (!decision.allowed) throw new ProductSettingsForbiddenError();
  }

  async list(context: AuthorizationContext) {
    await this.requireManage(context);
    const values = await this.repository.read(
      PRODUCT_SETTINGS_REGISTRY.map((definition) => definition.key),
    );
    const sections = new Map<
      string,
      { id: string; label: string; fields: Array<Record<string, unknown>> }
    >();
    for (const definition of PRODUCT_SETTINGS_REGISTRY) {
      const section = sections.get(definition.section) ?? {
        id: definition.section,
        label: definition.sectionLabel,
        fields: [],
      };
      section.fields.push({
        key: definition.key,
        label: definition.label,
        description: definition.description,
        type: definition.type,
        value: values.get(definition.key) ?? definition.defaultValue,
        editable: definition.editable,
        constraints: definition.constraints,
      });
      sections.set(definition.section, section);
    }
    return { sections: [...sections.values()] };
  }

  async update(
    context: AuthorizationContext,
    changes: Array<{ key: string; value: ProductSettingValue }>,
  ) {
    await this.requireManage(context);
    if (!changes.length) throw new ProductSettingsValidationError();
    const normalized = new Map<string, ProductSettingValue>();
    for (const change of changes) {
      const definition = findProductSettingDefinition(change.key);
      if (!definition?.editable || normalized.has(change.key))
        throw new ProductSettingsValidationError();
      if (
        typeof change.value !== "number" ||
        !Number.isInteger(change.value) ||
        change.value < definition.constraints.min ||
        change.value > definition.constraints.max
      )
        throw new ProductSettingsValidationError();
      normalized.set(change.key, change.value);
    }
    await this.repository.write([...normalized.entries()], context.userId);
    await this.audit.append({
      actorId: context.userId,
      action: "settings.updated",
      resourceType: "product-settings",
      metadata: { keys: [...normalized.keys()] },
    });
    return this.list(context);
  }
}
