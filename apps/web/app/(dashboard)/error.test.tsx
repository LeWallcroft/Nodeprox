import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DashboardError from "./error";

describe("dashboard error boundary", () => {
  it("presents backend unavailability without transport details", () => {
    const markup = renderToStaticMarkup(
      <DashboardError
        error={new Error("api-unavailable")}
        reset={() => undefined}
      />,
    );
    expect(markup).toContain("No se pudo conectar con NodeProx");
    expect(markup).toContain("Reintentar");
    expect(markup).not.toContain("ECONNREFUSED");
    expect(markup).not.toContain("localhost");
  });
});
