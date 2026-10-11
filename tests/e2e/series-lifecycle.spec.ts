import "dotenv/config";
import { randomBytes } from "node:crypto";
import { loadDatabaseConfig } from "@nodeprox/config";
import { expect, request, test } from "@playwright/test";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { AdminBootstrapService } from "../../apps/api/src/modules/authorization/application/services/admin-bootstrap.service.js";
import { DrizzleAdminBootstrapStore } from "../../apps/api/src/modules/authorization/infrastructure/bootstrap/drizzle-admin-bootstrap.store.js";
import { createDatabase } from "../../database/client.js";

const apiOrigin = "http://127.0.0.1:3101";

test("an administrator can inspect and reactivate a Series from the inactive board", async ({
  page,
}) => {
  const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
  const email = `series-lifecycle-e2e-${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("hex");
  const title = `Inactive board ${randomBytes(6).toString("hex")}`;
  let seriesId = "";
  const guest = await request.newContext({ baseURL: apiOrigin });
  let api = guest;
  try {
    await new AdminBootstrapService(
      new DrizzleAdminBootstrapStore(database.db),
      new Argon2PasswordHasher(),
    ).run({ email, password });
    const login = await guest.post("/auth/login", {
      data: { email, password },
      headers: { origin: apiOrigin },
    });
    expect(login.status()).toBe(204);
    const token = /^nodeprox_session=([^;]+)/.exec(
      login.headers()["set-cookie"] ?? "",
    )?.[1];
    if (!token) throw new Error("missing-session-cookie");
    api = await request.newContext({
      baseURL: apiOrigin,
      extraHTTPHeaders: { cookie: `nodeprox_session=${token}` },
    });
    await page.context().addCookies([
      {
        name: "nodeprox_session",
        value: token,
        url: "http://127.0.0.1:3100",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const created = await api.post("/series", {
      data: { title },
      headers: { origin: apiOrigin },
    });
    expect(created.status()).toBe(201);
    seriesId = (await created.json()).id;
    const deactivated = await api.post(`/series/${seriesId}/deactivate`, {
      data: { reason: "hiatus", reasonDetail: "Pausa editorial" },
      headers: { origin: apiOrigin },
    });
    expect(deactivated.status()).toBe(200);

    await page.goto("/series/inactive");
    await expect(
      page.getByRole("heading", { name: "Tablón olvidado" }),
    ).toBeVisible();
    const row = page
      .getByRole("table", { name: "Series deshabilitadas" })
      .getByRole("button", { name: new RegExp(title) });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText("Pausa editorial")).toBeVisible();
    await expect(page.getByText("Detalle histórico")).toBeVisible();
    await page.getByRole("button", { name: "Habilitar serie" }).click();
    await expect(row).toHaveCount(0);
    const active = await api.get("/series");
    expect(active.status()).toBe(200);
    expect(
      (await active.json()).some(
        (item: { id: string }) => item.id === seriesId,
      ),
    ).toBe(true);
  } finally {
    if (seriesId) {
      await api.delete(`/series/${seriesId}`, {
        headers: { origin: apiOrigin },
      });
    }
    if (api !== guest) await api.dispose();
    await guest.dispose();
    await database.sql.end();
  }
});
