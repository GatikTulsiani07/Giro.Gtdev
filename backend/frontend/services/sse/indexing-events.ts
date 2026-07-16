import { ApiClientError, apiUrl } from "@/services/api/client";
import type { IndexingProgress } from "@/types/api";

export interface IndexingEventHandlers {
  onProgress(event: IndexingProgress): void;
  onConnectionChange?(connected: boolean): void;
  onError?(error: Error): void;
}

interface StreamEvent {
  event: string;
  data: string;
}

export function parseSseBlock(block: string): StreamEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

function isTerminal(event: StreamEvent): boolean {
  return event.event === "completed" || event.event === "failed";
}

export async function consumeIndexingStream(
  repositoryId: string,
  token: string,
  handlers: IndexingEventHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(
    apiUrl(`/repositories/${encodeURIComponent(repositoryId)}/indexing/events`),
    { headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` }, signal },
  );
  if (!response.ok || !response.body) {
    throw new ApiClientError({
      code: response.status === 401 ? "unauthorized" : "sse_unavailable",
      message: "Indexing progress is temporarily unavailable.",
      status: response.status,
      retryable: response.status >= 500,
    });
  }

  handlers.onConnectionChange?.(true);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const parsed = parseSseBlock(block);
        if (!parsed || parsed.event === "heartbeat") continue;
        const progress = JSON.parse(parsed.data) as IndexingProgress;
        handlers.onProgress(progress);
        if (isTerminal(parsed)) return;
      }
    }
  } finally {
    handlers.onConnectionChange?.(false);
    reader.releaseLock();
  }
}

export async function subscribeToIndexing(
  repositoryId: string,
  token: string,
  handlers: IndexingEventHandlers,
  signal: AbortSignal,
): Promise<void> {
  let attempt = 0;
  while (!signal.aborted) {
    try {
      await consumeIndexingStream(repositoryId, token, handlers, signal);
      return;
    } catch (error) {
      if (signal.aborted) return;
      const normalized = error instanceof Error ? error : new Error("Indexing stream disconnected.");
      handlers.onError?.(normalized);
      const wait = Math.min(1000 * 2 ** attempt, 10_000);
      attempt += 1;
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, wait);
        signal.addEventListener("abort", () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  }
}
