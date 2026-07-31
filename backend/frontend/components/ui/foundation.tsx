import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineAlert } from "./inline-alert";
import { LoadingState } from "./data-display";
import { StatusBadge } from "./status-badge";

export function Loading({ label = "Loading" }: { label?: string }) {
  return <LoadingState label={label} />;
}

export function PartialState({
  children,
  diagnostics,
}: {
  children?: ReactNode;
  diagnostics: ReadonlyArray<{ code: string; message: string }>;
}) {
  return (
    <InlineAlert tone="warning">
      <p className="type-compact-strong text-warning">Partial result</p>
      <p className="mt-1">Giro returned usable data with incomplete supporting evidence.</p>
      {diagnostics.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {diagnostics.map((item) => <li key={`${item.code}-${item.message}`}>{item.message}</li>)}
        </ul>
      ) : null}
      {children}
    </InlineAlert>
  );
}

export function PageContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("layout-standard layout-gutter py-10 max-[820px]:py-7", className)} {...props} />;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border-subtle pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="type-section-eyebrow text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="mt-2 type-page-title">{title}</h1>
        {description ? <p className="mt-2 max-w-[68ch] type-body text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function RepositoryBadge({ repositoryId }: { repositoryId: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-badge bg-interactive px-2.5 py-1 type-mono text-text-secondary">
      <GitBranch className="size-3" aria-hidden="true" />
      <span className="truncate">{repositoryId}</span>
    </span>
  );
}

export function RevisionBadge({ revision }: { revision: string | null }) {
  return (
    <span title={revision ?? "No published revision"} className="inline-flex items-center rounded-badge bg-inset px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
      {revision ? revision.slice(0, 8) : "unpublished"}
    </span>
  );
}

export function BackendStatusBadge({ available }: { available: boolean | null }) {
  if (available === null) return <StatusBadge label="Backend checking" tone="neutral" />;
  return available
    ? <StatusBadge label="Backend online" tone="success" />
    : <StatusBadge label="Backend unavailable" tone="danger" />;
}

export function UnavailablePlaceholder({ title }: { title: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center border-y border-border-subtle px-5 text-center">
      <div>
        <AlertTriangle className="mx-auto size-4 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 type-panel-title">{title}</p>
        <p className="mt-1 type-compact text-muted-foreground">Available in a later frontend sprint.</p>
      </div>
    </div>
  );
}
