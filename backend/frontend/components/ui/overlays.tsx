"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="group relative inline-flex"><span>{children}</span><span role="tooltip" className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-overlay border border-border bg-elevated px-2 py-1 type-compact text-foreground opacity-0 shadow-overlay transition-opacity duration-[150ms] delay-[600ms] group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 motion-reduce:transition-none">{label}</span></span>;
}

export function Popover({ trigger, children, label }: { trigger: ReactNode; children: ReactNode; label: string }) {
  return <details className="group relative"><summary className="list-none rounded-control focus-ring" aria-label={label}>{trigger}</summary><div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-16px)] rounded-overlay border border-border bg-elevated p-4 shadow-overlay">{children}</div></details>;
}

export function Dropdown({ trigger, children, label }: { trigger: ReactNode; children: ReactNode; label: string }) {
  return <details className="group relative"><summary className="list-none rounded-control focus-ring" aria-label={label}>{trigger}</summary><div role="menu" className="absolute right-0 z-40 mt-2 min-w-48 rounded-overlay border border-border bg-elevated p-2 shadow-overlay">{children}</div></details>;
}

export function DropdownItem({ children, destructive, selected, onClick }: { children: ReactNode; destructive?: boolean; selected?: boolean; onClick?: () => void }) {
  return <button role="menuitem" type="button" onClick={onClick} className={cn("flex min-h-8 w-full items-center gap-2 rounded-badge px-2 type-compact text-text-secondary hover:bg-hover hover:text-foreground focus-ring", destructive && "text-danger", selected && "text-foreground")}>
    <span className="w-3">{selected ? <Check className="size-3" /> : null}</span>{children}
  </button>;
}

export function Modal({ open, title, description, children, footer, onClose, width = "default" }: { open: boolean; title: string; description?: string; children: ReactNode; footer?: ReactNode; onClose(): void; width?: "default" | "wide" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close(); }, [open]);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose} className={cn("m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] rounded-dialog border border-border bg-elevated p-0 text-foreground shadow-dialog backdrop:bg-overlay max-sm:mb-0 max-sm:max-h-[calc(100dvh-16px)] max-sm:w-full max-sm:rounded-b-none", width === "wide" ? "max-w-[640px]" : "max-w-[480px]")}><header className="flex items-start gap-4 border-b border-border-subtle p-6"><div className="min-w-0 flex-1"><h2 className="type-panel-title">{title}</h2>{description ? <p className="mt-1 type-compact text-muted-foreground">{description}</p> : null}</div><Button variant="ghost" size="icon-sm" aria-label="Close dialog" onClick={onClose}><X className="size-4" /></Button></header><div className="max-h-[60dvh] overflow-y-auto p-6">{children}</div>{footer ? <footer className="flex justify-end gap-2 border-t border-border-subtle p-6">{footer}</footer> : null}</dialog>;
}

export function ConfirmationDialog({ open, title, objectName, children, onCancel, onConfirm }: { open: boolean; title: string; objectName: string; children: ReactNode; onCancel(): void; onConfirm(): void }) {
  return <Modal open={open} title={title} description={`This action affects ${objectName}.`} onClose={onCancel} footer={<><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button variant="destructive" onClick={onConfirm}>Confirm</Button></>}><div className="flex items-start gap-3 type-body text-text-secondary"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />{children}</div></Modal>;
}

export function Toast({ tone = "info", title, description, onDismiss }: { tone?: "info" | "success" | "danger"; title: string; description?: string; onDismiss(): void }) {
  const Icon = tone === "success" ? Check : tone === "danger" ? AlertTriangle : Info;
  return <div role={tone === "danger" ? "alert" : "status"} className="flex w-full max-w-[360px] items-start gap-3 rounded-panel border border-border bg-elevated p-4 shadow-overlay"><Icon className={cn("mt-0.5 size-4", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-info")} /><div className="min-w-0 flex-1"><p className="type-body-strong">{title}</p>{description ? <p className="mt-1 type-compact text-muted-foreground">{description}</p> : null}</div><Button variant="ghost" size="icon-sm" aria-label="Dismiss notification" onClick={onDismiss}><X className="size-4" /></Button></div>;
}
