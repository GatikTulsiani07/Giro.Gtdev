"use client";

import { useState } from "react";
import { Check, Clipboard } from "lucide-react";
import { Button } from "./button";

export function CopyControl({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return <Button type="button" variant="ghost" size="icon-sm" aria-label={copied ? "Copied" : label} onClick={() => void copy()}>{copied ? <Check className="size-3.5 text-success" /> : <Clipboard className="size-3.5" />}</Button>;
}
