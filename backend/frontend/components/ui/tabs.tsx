import { useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export interface TabItem { id: string; label: string; disabled?: boolean; panelId?: string }

export function Tabs({ items, value, onValueChange, compact = false, label = "Sections" }: { items: TabItem[]; value: string; onValueChange(value: string): void; compact?: boolean; label?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function move(index: number, direction: number) {
    let next = index;
    do next = (next + direction + items.length) % items.length; while (items[next]?.disabled && next !== index);
    refs.current[next]?.focus();
    const id = items[next]?.id;
    if (id) onValueChange(id);
  }
  function moveTo(index: number) {
    const target = items[index];
    if (!target || target.disabled) return;
    refs.current[index]?.focus();
    onValueChange(target.id);
  }
  return <div role="tablist" aria-label={label} aria-orientation="horizontal" className={cn("flex h-10 items-stretch overflow-x-auto border-b border-border-subtle", compact && "h-auto gap-1 border-0")}>
    {items.map((item, index) => <button key={item.id} id={item.panelId ? `${item.panelId}-tab` : undefined} ref={(node) => { refs.current[index] = node; }} role="tab" aria-selected={item.id === value} aria-controls={item.panelId} disabled={item.disabled} tabIndex={item.id === value ? 0 : -1} onClick={() => onValueChange(item.id)} onKeyDown={(event) => { if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) event.preventDefault(); if (event.key === "ArrowRight") move(index, 1); if (event.key === "ArrowLeft") move(index, -1); if (event.key === "Home") moveTo(0); if (event.key === "End") moveTo(items.length - 1); }} className={cn("relative shrink-0 px-3 type-compact-strong text-text-secondary outline-none transition-colors duration-[150ms] hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus disabled:text-text-disabled", item.id === value && "text-foreground after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:bg-primary", compact && "h-8 rounded-control bg-transparent", compact && item.id === value && "bg-selection after:hidden")}>{item.label}</button>)}
  </div>;
}

export function SegmentedControl(props: Omit<ComponentProps<typeof Tabs>, "compact">) {
  return <Tabs {...props} compact />;
}
