import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ZIP_SIZE_BYTES,
  isZipFile,
  MAX_BULK_ZIP_FILES,
  MAX_BULK_ZIP_TOTAL_SIZE_BYTES,
  nextDragDepth,
  normalizeSelectedZipFiles,
} from "./utils";

function file(name: string, type: string, size = 4, lastModified = 1): File {
  return { name, type, size, lastModified } as File;
}

describe("isZipFile", () => {
  it.each([
    ["24.zip", "application/zip"],
    ["24.zip", "application/x-zip-compressed"],
    ["24.zip", ""],
    ["24.ZIP", "application/zip"],
    ["24.Zip", "application/x-zip-compressed"],
  ])("accepts %s with MIME %s", (name, type) => {
    expect(isZipFile(file(name, type))).toBe(true);
  });

  it.each([
    ["24.jpg", "image/jpeg"],
    ["24.png", "image/png"],
    ["24.exe", "application/x-msdownload"],
    ["24.pdf", "application/pdf"],
    ["24.zip", "image/jpeg"],
  ])("rejects %s with MIME %s", (name, type) => {
    expect(isZipFile(file(name, type))).toBe(false);
  });

  it("normalizes picker and drop selections through the same policy", () => {
    const selected = [file("24.zip", "application/zip")];
    expect(normalizeSelectedZipFiles(selected, { mode: "single" })).toEqual(
      normalizeSelectedZipFiles(selected, { mode: "single" }),
    );
  });

  it("accepts supported ZIP variants and an empty MIME with a ZIP extension", () => {
    const selection = normalizeSelectedZipFiles(
      [
        file("24.zip", "application/zip"),
        file("25.zip", "application/x-zip-compressed"),
        file("26.zip", ""),
      ],
      { mode: "bulk" },
    );
    expect(selection.files).toHaveLength(3);
    expect(selection.message).toBeNull();
  });

  it("rejects multiple ZIPs in single mode without choosing one", () => {
    expect(
      normalizeSelectedZipFiles(
        [file("24.zip", "application/zip"), file("25.zip", "application/zip")],
        { mode: "single" },
      ),
    ).toMatchObject({
      files: [],
      message: "Selecciona exactamente un archivo ZIP.",
    });
  });

  it("keeps the existing bulk policy of accepting valid ZIPs from a mixed selection", () => {
    const selection = normalizeSelectedZipFiles(
      [file("24.zip", "application/zip"), file("notes.txt", "text/plain")],
      { mode: "bulk" },
    );
    expect(selection.files.map((candidate) => candidate.name)).toEqual([
      "24.zip",
    ]);
    expect(selection.message).toContain("Se omitieron 1 archivo");
  });

  it("prevalidates bulk count, item size and aggregate size", () => {
    expect(
      normalizeSelectedZipFiles(
        Array.from({ length: MAX_BULK_ZIP_FILES + 1 }, (_, index) =>
          file(`${index}.zip`, "application/zip"),
        ),
        { mode: "bulk" },
      ).files,
    ).toEqual([]);
    expect(
      normalizeSelectedZipFiles(
        [file("large.zip", "application/zip", DEFAULT_MAX_ZIP_SIZE_BYTES + 1)],
        { mode: "single" },
      ).files,
    ).toEqual([]);
    expect(
      normalizeSelectedZipFiles(
        [
          file("1.zip", "application/zip", MAX_BULK_ZIP_TOTAL_SIZE_BYTES),
          file("2.zip", "application/zip", 1),
        ],
        { mode: "bulk" },
      ).files,
    ).toEqual([]);
  });

  it("deduplicates only within a browser selection and preserves drag depth", () => {
    const duplicate = file("24.zip", "application/zip", 4, 3);
    expect(
      normalizeSelectedZipFiles([duplicate, duplicate], { mode: "bulk" }).files,
    ).toHaveLength(1);
    expect(nextDragDepth(0, "enter")).toBe(1);
    expect(nextDragDepth(1, "enter")).toBe(2);
    expect(nextDragDepth(2, "leave")).toBe(1);
    expect(nextDragDepth(1, "leave")).toBe(0);
    expect(nextDragDepth(2, "drop")).toBe(0);
  });
});
