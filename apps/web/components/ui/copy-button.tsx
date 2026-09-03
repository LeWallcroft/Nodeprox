"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./button";

export type CopyState = "idle" | "copied" | "error";

export function createCopyResetTimer() {
  let timer: number | undefined;
  const clear = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  return {
    schedule(callback: () => void, delay: number) {
      clear();
      timer = window.setTimeout(callback, delay);
    },
    clear,
    dispose: clear,
  };
}

export async function copyToClipboard(value: string | null | undefined) {
  if (!value || typeof navigator === "undefined" || !navigator.clipboard)
    return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function useCopyToClipboard(resetAfterMs = 1500) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef(createCopyResetTimer());
  const attempt = useRef(0);

  useEffect(() => () => resetTimer.current.dispose(), []);

  const copy = useCallback(
    async (value: string | null | undefined) => {
      const currentAttempt = ++attempt.current;
      resetTimer.current.clear();
      setState("idle");
      const copied = await copyToClipboard(value);
      if (currentAttempt !== attempt.current) return copied;
      if (!copied) {
        setState("error");
        return false;
      }
      setState("copied");
      resetTimer.current.schedule(() => {
        if (currentAttempt === attempt.current) setState("idle");
      }, resetAfterMs);
      return true;
    },
    [resetAfterMs],
  );

  return { copy, state };
}

export function CopyButton({
  value,
  label = "Copiar URL",
  successLabel = "Copiado",
  failureMessage = "No se pudo copiar la URL.",
  className,
  disabled = false,
}: {
  value: string | null | undefined;
  label?: string;
  successLabel?: string;
  failureMessage?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { copy, state } = useCopyToClipboard();
  const canCopy = Boolean(value) && !disabled;
  const copied = state === "copied";
  return (
    <div className="grid justify-items-start gap-1">
      <Button
        className={className}
        type="button"
        disabled={!canCopy}
        onClick={() => void copy(value)}
      >
        {copied ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
        {copied ? successLabel : label}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? successLabel : ""}
      </span>
      {state === "error" ? (
        <span className="text-xs text-danger" role="alert">
          {failureMessage}
        </span>
      ) : null}
    </div>
  );
}
