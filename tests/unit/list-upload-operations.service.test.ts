import { describe, expect, it, vi } from "vitest";
import { ListUploadOperationsService } from "../../apps/api/src/modules/uploads/application/services/list-upload-operations.service.js";

describe("ListUploadOperationsService", () => {
  it.each([
    [undefined, 50],
    [0, 1],
    [25, 25],
    [500, 100],
  ])("bounds limit %s to %s", async (limit, expected) => {
    const repository = { listForUser: vi.fn(async () => []) };
    const service = new ListUploadOperationsService(repository);

    await service.execute({
      userId: "user-1",
      ...(limit === undefined ? {} : { limit }),
    });

    expect(repository.listForUser).toHaveBeenCalledWith({
      userId: "user-1",
      limit: expected,
    });
  });
});
