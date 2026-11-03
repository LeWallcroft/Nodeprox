import { expect, test } from "@playwright/test";

test("telemetry flag does not change the public login flow", async ({
  page,
}) => {
  const samples: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "info" &&
      message.text().includes("performance.sample")
    )
      samples.push(message.text());
  });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  expect(samples.length > 0).toBe(
    process.env.E2E_PERF_EXPECT_ENABLED === "true",
  );
});
