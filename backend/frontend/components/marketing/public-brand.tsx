import Link from "next/link";

export function PublicBrand() {
  return <Link href="/" aria-label="Giro home" className="flex items-center gap-3 rounded-control focus-ring"><span className="grid size-9 place-items-center rounded-control bg-primary type-body-strong text-primary-foreground">G</span><span className="type-panel-title text-foreground">Giro</span><span className="rounded-badge bg-inset px-1.5 type-metadata text-muted-foreground">DEV</span></Link>;
}
