export interface AdminBootstrapStore {
  ensureAdmin(input: {
    email: string;
    createPasswordHash: () => Promise<string>;
  }): Promise<AdminBootstrapResult>;
}

export type AdminBootstrapResult =
  | { outcome: "created"; userId: string }
  | { outcome: "promoted"; userId: string }
  | { outcome: "already-admin"; userId: string };

export interface AdminBootstrapPasswordHasher {
  hash(password: string): Promise<string>;
}

export class AdminBootstrapService {
  constructor(
    private readonly store: AdminBootstrapStore,
    private readonly passwordHasher: AdminBootstrapPasswordHasher,
  ) {}

  async run(input: {
    email: string;
    password: string;
  }): Promise<AdminBootstrapResult> {
    const email = input.email.trim().toLowerCase();
    if (!email || !input.password) {
      throw new Error("Admin bootstrap credentials are invalid");
    }

    return this.store.ensureAdmin({
      email,
      createPasswordHash: () => this.passwordHasher.hash(input.password),
    });
  }
}
