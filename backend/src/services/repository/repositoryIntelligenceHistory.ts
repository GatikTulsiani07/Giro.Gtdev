import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";
import { repositoryHistoryStore } from "./history/runtimeRepositoryHistoryStore.js";
import type { HistoryCursor } from "./history/repositoryHistoryStore.js";
import type { RepositoryIntelligenceResult } from "./repositoryIntelligenceService.js";

export interface RepositoryIntelligenceHistoryEntry {
  generatedAt: string;
  intelligence: RepositoryIntelligenceResult;
}
export interface SaveRepositoryIntelligenceOptions {
  ownerId?: string; repositoryRevision?: string; intelligenceType?: string;
  idempotencyKey?: string; model?: string; provider?: string; generatedAt?: string;
  retentionProtected?: boolean;
}
export interface RepositoryIntelligenceHistoryPage {
  entries: RepositoryIntelligenceHistoryEntry[];
  nextCursor: HistoryCursor | null;
}
function fallbackOwner(repositoryId: string): string { return repositoryId.split("/")[0] ?? repositoryId; }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function saveRepositoryIntelligence(
  intelligence: RepositoryIntelligenceResult, options?: SaveRepositoryIntelligenceOptions,
): void;
export function saveRepositoryIntelligence(
  intelligence: RepositoryIntelligenceResult, options: SaveRepositoryIntelligenceOptions = {},
): MaybePromise<void> {
  const type = options.intelligenceType ?? "repository_intelligence";
  const revision = options.repositoryRevision ?? "legacy";
  const idempotencyKey = options.idempotencyKey ?? hash(JSON.stringify({
    repositoryId: intelligence.repositoryId, revision, type, intelligence,
  }));
  const recordId = `intel_${hash(`${intelligence.repositoryId}:${type}:${idempotencyKey}`)}`;
  return mapMaybePromise(repositoryHistoryStore.insertIntelligence({
    recordId, idempotencyKey, repositoryId: intelligence.repositoryId,
    ownerId: options.ownerId ?? fallbackOwner(intelligence.repositoryId),
    repositoryRevision: revision, intelligenceType: type,
    payload: structuredClone(intelligence), model: options.model ?? null,
    provider: options.provider ?? null, generatedAt: options.generatedAt ?? new Date().toISOString(),
    retentionProtected: options.retentionProtected ?? false,
  }), () => undefined);
}

export function getRepositoryIntelligenceHistoryPage(input: {
  repositoryId: string; ownerId: string; repositoryRevision?: string;
  intelligenceType?: string; cursor?: HistoryCursor; limit?: number;
}): MaybePromise<RepositoryIntelligenceHistoryPage> {
  const limit = Math.min(input.limit ?? env.REPOSITORY_HISTORY_DEFAULT_PAGE_SIZE,
    env.REPOSITORY_HISTORY_MAX_PAGE_SIZE);
  return mapMaybePromise(repositoryHistoryStore.listIntelligence({
    repositoryId: input.repositoryId, ownerId: input.ownerId,
    revision: input.repositoryRevision, intelligenceType: input.intelligenceType ?? "repository_intelligence",
    cursor: input.cursor, limit,
  }), (page) => ({
    entries: page.records.map((record) => ({
      generatedAt: record.generatedAt,
      intelligence: structuredClone(record.payload) as RepositoryIntelligenceResult,
    })),
    nextCursor: page.nextCursor,
  }));
}

export function getRepositoryIntelligenceHistory(repositoryId: string, ownerId?: string,
  repositoryRevision?: string): RepositoryIntelligenceHistoryEntry[];
export function getRepositoryIntelligenceHistory(repositoryId: string, ownerId?: string,
  repositoryRevision?: string): MaybePromise<RepositoryIntelligenceHistoryEntry[]> {
  return mapMaybePromise(getRepositoryIntelligenceHistoryPage({
    repositoryId, ownerId: ownerId ?? fallbackOwner(repositoryId), repositoryRevision,
    limit: env.REPOSITORY_HISTORY_MAX_PAGE_SIZE,
  }), (page) => page.entries);
}

export function clearRepositoryIntelligenceHistory(repositoryId: string): void {
  if (!repositoryHistoryStore.deleteIntelligenceForTests) {
    throw new Error("Durable repository intelligence history cannot be cleared at runtime.");
  }
  repositoryHistoryStore.deleteIntelligenceForTests(repositoryId, "repository_intelligence");
}
