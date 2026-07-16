import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./button";
import { getApiErrorMessage } from "@/services/api/client";

export function ErrorState({ error, retry, compact = false }: { error: unknown; retry?: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={`rounded-lg border border-red-500/20 bg-red-500/5 ${compact ? "p-3" : "p-6"}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-200">Unable to load</p>
          <p className="mt-1 text-sm text-red-200/70">{getApiErrorMessage(error)}</p>
        </div>
        {retry ? <Button variant="ghost" size="sm" onClick={retry}><RotateCcw className="size-3.5" />Retry</Button> : null}
      </div>
    </div>
  );
}
