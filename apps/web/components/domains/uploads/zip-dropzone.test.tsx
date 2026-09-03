import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ZipDropzone } from "./zip-dropzone";

describe("ZipDropzone", () => {
  it("keeps click-to-select available for the single ZIP flow", () => {
    const markup = renderToStaticMarkup(
      <ZipDropzone mode="single" onFilesSelected={() => undefined} />,
    );
    expect(markup).toContain('type="file"');
    expect(markup).toContain("Arrastra un ZIP aquí");
    expect(markup).toContain("sr-only");
  });

  it("renders a multiple, disabled bulk control without enabling interaction", () => {
    const markup = renderToStaticMarkup(
      <ZipDropzone mode="bulk" disabled onFilesSelected={() => undefined} />,
    );
    expect(markup).toContain("multiple");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Arrastra uno o varios ZIP aquí");
  });
});
