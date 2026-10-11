import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Card } from "./card.js";

describe("Card density", () => {
  it("uses one compact padding utility without the default padding", () => {
    const markup = renderToStaticMarkup(<Card density="compact">Filtros</Card>);

    expect(markup).toContain("p-3");
    expect(markup).not.toContain("p-5");
  });
});
