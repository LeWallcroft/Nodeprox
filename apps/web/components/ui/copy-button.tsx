"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3.5 font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      type="button"
      onClick={copy}
    >
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}
