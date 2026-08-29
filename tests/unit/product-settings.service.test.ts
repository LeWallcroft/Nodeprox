import { describe, expect, it, vi } from "vitest";
import {
  ProductSettingsService,
  ProductSettingsValidationError,
} from "../../apps/api/src/modules/authorization/application/services/product-settings.service.js";
import type { AuthorizationService } from "../../apps/api/src/modules/authorization/application/services/authorization.service.js";

function setup(values = new Map<string, number | boolean | string>()) {
  const repository = {
    read: vi.fn().mockResolvedValue(values),
    write: vi.fn().mockResolvedValue(undefined),
  };
  const authorization = {
    authorize: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as AuthorizationService;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  return {
    repository,
    audit,
    service: new ProductSettingsService(repository, authorization, audit),
  };
}

describe("ProductSettingsService", () => {
  const context = { userId: "user-1", sessionId: "session-1" };

  it("projects only registered product settings with persisted overrides", async () => {
    const { service } = setup(new Map([["helper_cooldown_days", 14]]));
    await expect(service.list(context)).resolves.toEqual({
      sections: expect.arrayContaining([
        expect.objectContaining({
          fields: [
            expect.objectContaining({ key: "helper_cooldown_days", value: 14 }),
          ],
        }),
      ]),
    });
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

  it("persists registered values and audits only changed key names", async () => {
    const { service, repository, audit } = setup();
    await service.update(context, [{ key: "helper_cooldown_days", value: 0 }]);
    expect(repository.write).toHaveBeenCalledWith(
      [["helper_cooldown_days", 0]],
      "user-1",
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { keys: ["helper_cooldown_days"] } }),
    );
  });
});
