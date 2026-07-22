import { createHash, randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";
import { repositoryHistoryStore } from "./history/runtimeRepositoryHistoryStore.js";
import type { HistoryCursor, LifecycleHistoryRecord } from "./history/repositoryHistoryStore.js";

export type RepositoryLifecycleEventType =
  | "repository_connected" | "repository_indexed" | "repository_dashboard_viewed"
  | "repository_cleanup_planned" | "repository_cleanup_executed"
  | "repository_cleanup_reported" | "repository_cleanup_failed";
export type RepositoryLifecycleEventMetadataValue = string | number | boolean | null | string[];
export type RepositoryLifecycleEventMetadata = Record<string, RepositoryLifecycleEventMetadataValue>;
export interface RepositoryLifecycleEvent {
  repositoryId: string; sequence: number; type: RepositoryLifecycleEventType;
  message: string; metadata: RepositoryLifecycleEventMetadata;
}
export interface RecordRepositoryLifecycleEventInput {
  repositoryId: string; ownerId?: string; repositoryRevision?: string | null;
  type: RepositoryLifecycleEventType; message: string; metadata?: RepositoryLifecycleEventMetadata;
  eventId?: string; idempotencyKey?: string; requestId?: string; traceId?: string;
  createdAt?: string; retentionProtected?: boolean;
}
export interface RepositoryLifecycleEventPage {
  events: RepositoryLifecycleEvent[]; nextCursor: HistoryCursor | null;
}

function copyMetadata(metadata: RepositoryLifecycleEventMetadata): RepositoryLifecycleEventMetadata {
  return Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) =>
    [key, Array.isArray(value) ? [...value].sort((a, b) => a.localeCompare(b)) : value]));
}
function publicEvent(event: LifecycleHistoryRecord): RepositoryLifecycleEvent {
  const payload = event.payload as { message?: unknown; metadata?: unknown };
  return {
    repositoryId: event.repositoryId, sequence: event.orderingKey,
    type: event.eventType as RepositoryLifecycleEventType,
    message: typeof payload.message === "string" ? payload.message : "",
    metadata: copyMetadata((payload.metadata ?? {}) as RepositoryLifecycleEventMetadata),
  };
}
function fallbackOwner(_repositoryId: string): string { return "*"; }
function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

export function recordRepositoryLifecycleEvent(input: RecordRepositoryLifecycleEventInput): RepositoryLifecycleEvent;
export function recordRepositoryLifecycleEvent(input: RecordRepositoryLifecycleEventInput): MaybePromise<RepositoryLifecycleEvent> {
  const metadata = copyMetadata(input.metadata ?? {});
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const eventId = input.eventId ?? stableId("evt", `${input.repositoryId}:${idempotencyKey}`);
  return mapMaybePromise(repositoryHistoryStore.insertLifecycle({
    eventId, idempotencyKey, repositoryId: input.repositoryId,
    ownerId: input.ownerId ?? fallbackOwner(input.repositoryId),
    repositoryRevision: input.repositoryRevision ?? null, eventType: input.type,
    payload: { message: input.message, metadata }, requestId: input.requestId ?? null,
    traceId: input.traceId ?? null, createdAt: input.createdAt ?? new Date().toISOString(),
    retentionProtected: input.retentionProtected ?? false,
  }), publicEvent);
}

export function listRepositoryLifecycleEventPage(input: {
  repositoryId: string; ownerId: string; revision?: string; eventType?: RepositoryLifecycleEventType;
  cursor?: HistoryCursor; limit?: number;
}): MaybePromise<RepositoryLifecycleEventPage> {
  const limit = Math.min(input.limit ?? env.REPOSITORY_HISTORY_DEFAULT_PAGE_SIZE,
    env.REPOSITORY_HISTORY_MAX_PAGE_SIZE);
  return mapMaybePromise(repositoryHistoryStore.listLifecycle({ ...input, limit }), (page) => ({
    events: page.records.map(publicEvent), nextCursor: page.nextCursor,
  }));
}

export function listRepositoryLifecycleEvents(repositoryId?: string, ownerId?: string): RepositoryLifecycleEvent[];
export function listRepositoryLifecycleEvents(repositoryId?: string, ownerId?: string): MaybePromise<RepositoryLifecycleEvent[]> {
  if (!repositoryId) {
    const records = repositoryHistoryStore.listAllLifecycleForTests?.();
    if (!records) throw new Error("Repository and owner filters are required for durable lifecycle reads.");
    return records.map(publicEvent);
  }
  return mapMaybePromise(listRepositoryLifecycleEventPage({
    repositoryId, ownerId: ownerId ?? fallbackOwner(repositoryId),
    limit: env.REPOSITORY_HISTORY_MAX_PAGE_SIZE,
  }), (page) => page.events);
}

export function clearRepositoryLifecycleEvents(): void {
  const cleared = repositoryHistoryStore.clear();
  if (cleared instanceof Promise) throw new Error("Durable repository history cannot be cleared at runtime.");
}
