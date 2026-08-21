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
