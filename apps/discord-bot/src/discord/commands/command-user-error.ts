export class CommandUserError extends Error {
  constructor(
    readonly userMessage: string,
    readonly cause: unknown,
  ) {
    super("discord-command-user-error");
  }
}
