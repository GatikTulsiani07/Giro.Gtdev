"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Drawer({ open, label, side, onClose, children, className }: { open: boolean; label: string; side: "left" | "right" | "full"; onClose(): void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return <dialog ref={ref} aria-label={label} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose} className={cn("fixed inset-y-0 m-0 h-dvh max-h-none border-0 bg-panel p-0 text-foreground shadow-dialog backdrop:bg-overlay", side === "left" && "left-0 w-[360px] max-w-full", side === "right" && "left-auto right-0 w-[360px] max-w-full", side === "full" && "inset-0 w-full max-w-none", className)}>{open ? children : null}</dialog>;
}
