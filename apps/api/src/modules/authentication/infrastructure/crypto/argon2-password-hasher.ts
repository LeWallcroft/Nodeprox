import argon2 from "argon2";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
  verifyDummy(password: string): Promise<boolean>;
}

export class Argon2PasswordHasher implements PasswordHasher {
  private readonly dummyHash = argon2.hash(
    "nodeprox-invalid-credential-dummy",
    {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    },
  );
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, {
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  async verifyDummy(password: string): Promise<boolean> {
    return argon2.verify(await this.dummyHash, password);
  }
}
