import { expect, test } from "@playwright/test";

test("login route is public and does not render the dashboard shell", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Navegación principal" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "NodeProx dashboard" }),
  ).toHaveCount(0);
});

test("browser domain calls use the same-origin API boundary", async ({
  page,
}) => {
  await page.goto("/login");
  const requests: string[] = [];
  await page.route("**/api/auth/login", async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 204 });
  });

  const result = await page.evaluate(async () => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "e2e@example.com", password: "invalid" }),
    });
    return { status: response.status, url: new URL(response.url).pathname };
  });

  expect(result).toEqual({ status: 204, url: "/api/auth/login" });
  expect(requests).toEqual(["/api/auth/login"]);
});
