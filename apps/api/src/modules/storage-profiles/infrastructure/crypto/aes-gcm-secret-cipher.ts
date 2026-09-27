import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretCipherPort } from "../../application/ports/storage-profile.ports.js";

/** The key is a separate 32-byte deployment secret, never stored with a profile. */
export class AesGcmSecretCipher implements SecretCipherPort {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32 || key.toString("base64") !== base64Key)
      throw new Error("storage-profile-cipher-key-invalid");
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
  }

  decrypt(value: string): string {
    const [version, iv, tag, ciphertext, extra] = value.split(":");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra)
      throw new Error("storage-profile-ciphertext-invalid");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
