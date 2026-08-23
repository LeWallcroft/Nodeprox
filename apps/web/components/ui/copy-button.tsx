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
    <button className="button button-secondary" type="button" onClick={copy}>
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}
