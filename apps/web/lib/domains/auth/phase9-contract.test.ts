import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Phase 9 auth presentation contract", () => {
  it("keeps Discord username in the registration payload contract", () => {
    expect(read("apps/web/lib/domains/auth/types.ts")).toContain("discordUsername");
    expect(read("apps/web/app/(auth)/register/page.tsx")).toContain("Usuario de Discord");
  });

  it("uses the local branding asset across auth screens", () => {
    for (const page of ["login", "register", "account-pending"])
      expect(read(`apps/web/app/(auth)/${page}/page.tsx`)).toContain("/branding/nodeprox-logo.png");
  });

  it("keeps pending approval and human login errors visible", () => {
    expect(read("apps/web/app/(auth)/account-pending/page.tsx")).toContain("Un administrador debe aprobar");
    expect(read("apps/web/app/(auth)/login/page.tsx")).toContain("Email o contraseña incorrectos.");
  });
});
