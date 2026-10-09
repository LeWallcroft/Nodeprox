import { describe, expect, it, vi } from "vitest";
import type { AuthorizationService } from "../../apps/api/src/modules/authorization/application/services/authorization.service.js";
import {
  ProductSettingsService,
  ProductSettingsValidationError,
} from "../../apps/api/src/modules/authorization/application/services/product-settings.service.js";

function setup(values = new Map<string, number | boolean | string>()) {
  const repository = {
    read: vi.fn().mockResolvedValue(values),
    writeWithAudit: vi.fn().mockResolvedValue(undefined),
  };
  const authorization = {
    authorize: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as AuthorizationService;
  return {
    repository,
    service: new ProductSettingsService(repository, authorization),
  };
}

describe("ProductSettingsService", () => {
  const context = { userId: "user-1", sessionId: "session-1" };

  it("projects only registered product settings with persisted overrides", async () => {
    const { service } = setup(new Map([["helper_cooldown_days", 14]]));
    const result = await service.list(context);
    const fields = result.sections.flatMap((section) => section.fields);
    expect(fields).toHaveLength(10);
    expect(fields).toContainEqual(
      expect.objectContaining({
        key: "helper_cooldown_days",
        value: 14,
        label: "Espera para volver a colaborar",
        unit: "días",
        helpText:
          "Tiempo mínimo antes de volver a conceder colaboración en la misma serie.",
        impact: "Cambia cuándo puede volver a concederse colaboración.",
        constraints: { min: 0, max: 365 },
      }),
    );
    expect(fields).toContainEqual(
      expect.objectContaining({
        key: "bulk_upload_concurrency",
        label: "Subidas ZIP simultáneas",
        unit: "cargas",
        constraints: { min: 1, max: 5 },
      }),
    );
  });

  it("rejects unknown and out-of-range values", async () => {
    const { service } = setup();
    await expect(
      service.update(context, [{ key: "DATABASE_URL", value: "x" }]),
    ).rejects.toBeInstanceOf(ProductSettingsValidationError);
    await expect(
      service.update(context, [{ key: "helper_cooldown_days", value: 366 }]),
    ).rejects.toBeInstanceOf(ProductSettingsValidationError);
  });

  it("persists registered values and their audit in one repository operation", async () => {
    const { service, repository } = setup();
    await service.update(
      context,
      [{ key: "helper_cooldown_days", value: 0 }],
      "req-settings",
    );
    expect(repository.writeWithAudit).toHaveBeenCalledWith({
      changes: [["helper_cooldown_days", 0]],
      actorId: "user-1",
      requestId: "req-settings",
    });
  });

  it("rejects warning thresholds above an enabled hard limit", async () => {
    const { service } = setup();
    await expect(
      service.update(context, [
        { key: "upload_max_width_px", value: 3000 },
        { key: "upload_warning_width_px", value: 4000 },
      ]),
    ).rejects.toBeInstanceOf(ProductSettingsValidationError);
    await expect(
      service.update(context, [
        { key: "upload_max_width_px", value: 0 },
        { key: "upload_warning_width_px", value: 4000 },
      ]),
    ).resolves.toBeDefined();
  });

  it("accepts lower or equal image-size warning thresholds and rejects higher ones", async () => {
    const { service } = setup();
    await expect(
      service.update(context, [
        { key: "upload_max_image_size_mb", value: 5 },
        { key: "upload_warning_image_size_mb", value: 3 },
      ]),
    ).resolves.toBeDefined();
    await expect(
      service.update(context, [
        { key: "upload_max_image_size_mb", value: 5 },
        { key: "upload_warning_image_size_mb", value: 5 },
      ]),
    ).resolves.toBeDefined();
    await expect(
      service.update(context, [
        { key: "upload_max_image_size_mb", value: 5 },
        { key: "upload_warning_image_size_mb", value: 6 },
      ]),
    ).rejects.toBeInstanceOf(ProductSettingsValidationError);
  });

  it("validates warning height against the enabled hard height", async () => {
    const { service } = setup();
    await expect(
      service.update(context, [
        { key: "upload_max_height_px", value: 12000 },
        { key: "upload_warning_height_px", value: 12000 },
      ]),
    ).resolves.toBeDefined();
    await expect(
      service.update(context, [
        { key: "upload_max_height_px", value: 12000 },
        { key: "upload_warning_height_px", value: 12001 },
      ]),
    ).rejects.toBeInstanceOf(ProductSettingsValidationError);
  });
});
