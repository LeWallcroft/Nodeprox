import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Chapter image management focus contract", () => {
  it("keeps focused and bulk image selection separate with toggle behavior", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/series/[seriesId]/chapters/[chapterId]/images/page.tsx",
      "utf8",
    );
    expect(page).toContain("selectedImageIds");
    expect(page).toContain("selectedImageId");
    expect(page).toContain("current === image.id ? null : image.id");
    expect(page).toContain("event.target.checked");
    expect(page).toContain("focused === image.id ? null : focused");
    expect(page).toContain("images.map((image)");
    expect(page).not.toContain("Selecciona una imagen en la tabla o el visor.");
  });

  it("keeps the viewer wide, scrollable, and backed by canonical images", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/series/[seriesId]/chapters/[chapterId]/images/page.tsx",
      "utf8",
    );
    const action = readFileSync(
      "apps/web/components/domains/chapters/selected-image-replacement-action.tsx",
      "utf8",
    );
    expect(page).toContain("xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]");
    expect(page).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(action).toContain("JPG/JPEG, PNG, WEBP o GIF");
    expect(action).toContain("No se permiten archivos ZIP.");
    expect(action).not.toContain("AVIF");
    expect(page).not.toContain("_v2");
    expect(page).toContain("grid-cols-[5rem_minmax(0,1fr)_auto]");
    expect(page).toContain("flex w-max flex-col items-stretch gap-2");
    expect(page).toContain("compact");
    expect(page).toContain("<Image aria-hidden");
    expect(page).toContain("<Images aria-hidden");
    expect(page).toContain("flex flex-nowrap items-center justify-between");
    expect(page).toContain("Ajustar ancho ▾");
    expect(page).toContain("border border-primary bg-primary-soft");
  });
});
