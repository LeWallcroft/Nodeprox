const ZIP_MIME_TYPES = new Set([
  "",
  "application/zip",
  "application/x-zip-compressed",
]);

export function isZipFile(file: File): boolean {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

  return extension === ".zip" && ZIP_MIME_TYPES.has(file.type);
}
