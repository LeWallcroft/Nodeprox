import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmSecretCipher } from "./aes-gcm-secret-cipher.js";

describe("AES-256-GCM storage profile credentials", () => {
  it("roundtrips without storing plaintext and uses a fresh nonce", () => {
    const cipher = new AesGcmSecretCipher(randomBytes(32).toString("base64"));
    const first = cipher.encrypt("private-application-key");
    const second = cipher.encrypt("private-application-key");
    expect(first).not.toBe(second);
    expect(first).not.toContain("private-application-key");
    expect(cipher.decrypt(first)).toBe("private-application-key");
    expect(cipher.decrypt(second)).toBe("private-application-key");
  });

  it("rejects tampering and wrong keys", () => {
    const cipher = new AesGcmSecretCipher(randomBytes(32).toString("base64"));
    const different = new AesGcmSecretCipher(
      randomBytes(32).toString("base64"),
    );
    const encrypted = cipher.encrypt("private-application-key");
    expect(() => different.decrypt(encrypted)).toThrow();
    const parts = encrypted.split(":");
    expect(() =>
      cipher.decrypt(
        `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from("tampered").toString("base64")}`,
      ),
    ).toThrow();
    expect(() => new AesGcmSecretCipher("bad-key")).toThrow();
  });
});
