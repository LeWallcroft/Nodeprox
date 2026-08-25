import { describe, expect, it } from "vitest";
import { isZipFile } from "./utils";

function file(name: string, type: string): File {
  return { name, type } as File;
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
});
