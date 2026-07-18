import type { HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export function Divider({ className, ...props }: HTMLAttributes<HTMLHRElement>) { return <hr className={cn("border-0 border-t border-border-subtle", className)} {...props} />; }

export function ListRow({ children, interactive = false, selected = false, className, ...props }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean; selected?: boolean }) {
  return <div className={cn("relative flex min-h-10 items-center gap-3 border-b border-border-subtle px-3 type-compact", interactive && "transition-colors duration-[150ms] hover:bg-hover", selected && "bg-selection before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:bg-primary", className)} {...props}>{children}</div>;
}

export function Table({ children, label }: { children: ReactNode; label: string }) { return <div className="overflow-x-auto"><table aria-label={label} className="w-full border-collapse type-compact">{children}</table></div>; }
export function TableHeader({ children }: { children: ReactNode }) { return <thead className="h-8 border-b border-border-subtle type-table-header text-muted-foreground">{children}</thead>; }
export function TableRow({ children }: { children: ReactNode }) { return <tr className="min-h-10 border-b border-border-subtle hover:bg-hover">{children}</tr>; }

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) { return <nav aria-label="Breadcrumb"><ol className="flex min-w-0 items-center gap-2 type-compact text-muted-foreground">{items.map((item, index) => <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-2">{index ? <ChevronRight className="size-3 shrink-0" aria-hidden="true" /> : null}{item.href ? <Link href={item.href} className="truncate rounded-control hover:text-foreground focus-ring">{item.label}</Link> : <span aria-current="page" className="truncate text-foreground">{item.label}</span>}</li>)}</ol></nav>; }

export function Pagination({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange(page: number): void }) { return <nav aria-label="Pagination" className="flex items-center gap-2"><Button variant="secondary" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft className="size-4" /></Button><span className="type-metadata text-muted-foreground">Page {page} of {pageCount}</span><Button variant="secondary" size="icon-sm" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}><ChevronRight className="size-4" /></Button></nav>; }

export function LoadingState({ label, children }: { label: string; children?: ReactNode }) { return <div role="status" aria-live="polite" className="flex min-h-64 flex-col items-center justify-center gap-3 text-center"><span className="size-4 animate-spin rounded-full border-2 border-border border-t-info motion-reduce:animate-none" /><p className="type-compact text-muted-foreground">{label}</p>{children}</div>; }
