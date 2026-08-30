const [operation, ...arguments_] = process.argv.slice(2);

if (operation === "migrate" && arguments_.length === 0) {
  await import("./migrate.mjs");
} else if (
  operation === "pnpm" &&
  arguments_.length === 1 &&
  arguments_[0] === "db:bootstrap:admin"
) {
  // Preserve the documented Compose invocation without invoking pnpm at runtime.
  await import("./bootstrap-admin.mjs");
} else {
  throw new Error(
    "Migration runner supports only: migrate or pnpm db:bootstrap:admin",
  );
}
