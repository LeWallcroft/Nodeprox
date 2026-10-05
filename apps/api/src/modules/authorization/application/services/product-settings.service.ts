import type { AuthorizationContext } from "../../domain/authorization.types.js";
import { PERMISSIONS } from "../../domain/permissions.js";
import {
  findProductSettingDefinition,
  PRODUCT_SETTINGS_REGISTRY,
  type ProductSettingValue,
} from "../../domain/product-settings.registry.js";
import type { ProductSettingsRepository } from "../ports/authorization.ports.js";
import type { AuthorizationService } from "./authorization.service.js";

export class ProductSettingsValidationError extends Error {}
export class ProductSettingsForbiddenError extends Error {}

export class ProductSettingsService {
  constructor(
    private readonly repository: ProductSettingsRepository,
    private readonly authorization: AuthorizationService,
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
        unit: definition.unit,
        helpText: definition.helpText,
        impact: definition.impact,
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
    requestId?: string,
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
    const relevantKeys = PRODUCT_SETTINGS_REGISTRY.map(({ key }) => key);
    const current = await this.repository.read(relevantKeys);
    const effective = new Map<string, number>();
    for (const definition of PRODUCT_SETTINGS_REGISTRY) {
      const value =
        normalized.get(definition.key) ??
        current.get(definition.key) ??
        definition.defaultValue;
      if (typeof value === "number") effective.set(definition.key, value);
    }
    const pairs = [
      ["upload_warning_image_size_mb", "upload_max_image_size_mb"],
      ["upload_warning_width_px", "upload_max_width_px"],
      ["upload_warning_height_px", "upload_max_height_px"],
    ] as const;
    for (const [warningKey, hardKey] of pairs) {
      const warning = effective.get(warningKey);
      const hard = effective.get(hardKey);
      if (
        warning !== undefined &&
        hard !== undefined &&
        hard > 0 &&
        warning > hard
      )
        throw new ProductSettingsValidationError();
    }
    await this.repository.writeWithAudit({
      changes: [...normalized.entries()],
      actorId: context.userId,
      ...(requestId ? { requestId } : {}),
    });
    return this.list(context);
  }
}
