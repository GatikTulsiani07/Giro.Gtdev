import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./button";
import { ApiClientError, getApiErrorMessage } from "@/services/api/client";

export function ErrorState({ error, retry, compact = false }: { error: unknown; retry?: () => void; compact?: boolean }) {
  const normalized = error instanceof ApiClientError ? error : null;
  return (
    <div role="alert" className={`rounded-control border-0 border-l-2 border-border-danger bg-danger/5 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="type-body-strong text-danger">Unable to load</p>
          <p className="mt-1 type-compact text-text-secondary">{getApiErrorMessage(error)}</p>
          {normalized?.fieldErrors ? <ul className="mt-2 space-y-1 type-compact text-text-secondary">{Object.entries(normalized.fieldErrors).flatMap(([field, messages]) => messages.map((message) => <li key={`${field}-${message}`}>{field}: {message}</li>))}</ul> : null}
          {normalized?.requestId ? <details className="mt-3 type-metadata text-muted-foreground"><summary className="cursor-pointer focus-ring">Technical details</summary><p className="mt-1">Request ID: {normalized.requestId}</p></details> : null}
        </div>
        {retry ? <Button variant="secondary" size="sm" onClick={retry}><RotateCcw className="size-3.5" />Retry</Button> : null}
      </div>
    </div>
  );
}
