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
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(samples.length > 0).toBe(
    process.env.E2E_PERF_EXPECT_ENABLED === "true",
  );
});

test("SPA navigation attributes image samples to the allowlisted destination", async ({
  page,
}) => {
  const batches: { samples: Record<string, unknown>[]; dropped: number }[] = [];
  page.on("console", (message) => {
    if (!message.text().startsWith("performance.samples ")) return;
    const jsonStart = message.text().indexOf("{");
    if (jsonStart < 0) return;
    try {
      batches.push(JSON.parse(message.text().slice(jsonStart)));
    } catch {
      // Ignore unrelated console text.
    }
  });
  await page.route("**/perf0-sample-image.svg*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
    }),
  );
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
  const routes = [
    "/series/private-series",
    "/series/private-series/chapters",
    "/series/private-series/chapters/private-chapter/images",
  ];
  await page.evaluate((routeList) => {
    for (const [index, href] of routeList.entries()) {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = `fixture-nav-${index}`;
      link.dataset.testid = `fixture-nav-${index}`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        history.pushState({}, "", href);
      });
      document.body.append(link);
    }
  }, routes);
  for (let index = 0; index < routes.length; index++) {
    await page.getByTestId(`fixture-nav-${index}`).click();
    await expect
      .poll(() => page.evaluate(() => location.pathname))
      .toBe(routes[index]);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
  await page.evaluate(async () => {
    const image = new Image();
    image.src = "/perf0-sample-image.svg?token=private-token";
    await image.decode();
    document.body.append(image);
  });
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

  const samples = batches.flatMap((batch) => batch.samples);
  const enabled = process.env.E2E_PERF_EXPECT_ENABLED === "true";
  expect(samples.some((sample) => sample.navigationKind === "spa")).toBe(
    enabled,
  );
  if (enabled) {
    expect(samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeTemplate: "/series/:seriesId/chapters/:chapterId/images",
          metric: "media.image.transfer.duration",
          stage: "media-network",
          navigationKind: "spa",
          unit: "ms",
        }),
      ]),
    );
  } else {
    expect(batches).toHaveLength(0);
  }
  expect(JSON.stringify(batches)).not.toMatch(
    /private-series|private-chapter|private-token/,
  );
});
