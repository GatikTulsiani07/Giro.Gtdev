import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => <span className="relative block"><select ref={ref} className={cn("h-10 w-full appearance-none rounded-control border border-border bg-interactive px-2.5 pr-9 type-compact text-foreground outline-none transition-colors duration-[150ms] focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:text-text-disabled max-[820px]:h-11", className)} {...props}>{children}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-3 size-3.5 text-muted-foreground max-[820px]:top-[15px]" /></span>,
);
Select.displayName = "Select";

export const SearchInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { onClear?: () => void }>(
  ({ className, value, onChange, onClear, ...props }, ref) => <span className="relative block"><Search className="pointer-events-none absolute left-2.5 top-[13px] size-3.5 text-muted-foreground max-[820px]:top-[15px]" /><input ref={ref} type="search" value={value} onChange={onChange} className={cn("h-10 w-full rounded-control border border-border bg-interactive pl-8 pr-10 type-compact text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background max-[820px]:h-11", className)} {...props} />{value && onClear ? <button type="button" aria-label="Clear search" onClick={onClear} className="absolute right-1 top-1 grid size-8 place-items-center rounded-control text-muted-foreground hover:bg-hover hover:text-foreground focus-ring max-[820px]:right-0 max-[820px]:top-0 max-[820px]:size-11"><X className="size-3.5" /></button> : null}</span>,
);
SearchInput.displayName = "SearchInput";

export function Checkbox({ label, description, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = React.useId();
  return <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-2 max-[820px]:min-h-11 max-[820px]:items-center", className)}><span className="relative mt-0.5 size-4 shrink-0"><input id={id} type="checkbox" className="peer size-4 appearance-none rounded border border-border bg-interactive outline-none checked:border-primary checked:bg-primary focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background" {...props} /><Check className="pointer-events-none absolute inset-0 hidden size-4 p-0.5 text-primary-foreground peer-checked:block" /></span><span><span className="block type-compact-strong text-foreground">{label}</span>{description ? <span className="mt-1 block type-compact text-muted-foreground">{description}</span> : null}</span></label>;
}

export function Radio({ label, description, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; description?: string }) {
  const id = React.useId();
  return <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-2 max-[820px]:min-h-11 max-[820px]:items-center", className)}><span className="relative mt-0.5 size-4 shrink-0"><input id={id} type="radio" className="peer size-4 appearance-none rounded-full border border-border bg-interactive outline-none checked:border-primary focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background" {...props} /><span className="pointer-events-none absolute left-[5px] top-[5px] hidden size-1.5 rounded-full bg-primary peer-checked:block" /></span><span><span className="block type-compact-strong text-foreground">{label}</span>{description ? <span className="mt-1 block type-compact text-muted-foreground">{description}</span> : null}</span></label>;
}

export function Switch({ checked, onCheckedChange, label, description, disabled }: { checked: boolean; onCheckedChange(checked: boolean): void; label: string; description?: string; disabled?: boolean }) {
  return <label className="flex cursor-pointer items-start gap-3 max-[820px]:min-h-11 max-[820px]:items-center"><button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onCheckedChange(!checked)} className={cn("relative mt-0.5 h-[18px] w-8 shrink-0 rounded-badge border outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60", checked ? "border-primary bg-primary" : "border-border bg-interactive")}><span className={cn("absolute top-px size-3.5 rounded-full bg-foreground transition-[left] duration-[150ms] motion-reduce:transition-none", checked ? "left-4" : "left-0.5")} /></button><span><span className="block type-compact-strong text-foreground">{label}</span>{description ? <span className="mt-1 block type-compact text-muted-foreground">{description}</span> : null}</span></label>;
}
