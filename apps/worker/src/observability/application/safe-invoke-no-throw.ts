/** Keep observer and logger failures outside the Worker result, including accidental async returns. */
export function safeInvokeNoThrow(invoke: () => unknown): void {
  try {
    const returned = invoke();
    if (
      returned !== null &&
      (typeof returned === "object" || typeof returned === "function")
    ) {
      Promise.resolve(returned).catch(() => {});
    }
  } catch {
    // Observability is best effort and must not change business execution.
  }
}
