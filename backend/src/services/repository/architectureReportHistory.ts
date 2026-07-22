import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";
import { repositoryHistoryStore } from "./history/runtimeRepositoryHistoryStore.js";

export interface ArchitectureHistoryEntry { repositoryId: string; generatedAt: string; report: unknown; }
export interface ArchitectureHistoryOptions {
  ownerId?: string; repositoryRevision?: string; idempotencyKey?: string;
  model?: string; provider?: string;
}
function owner(repositoryId: string): string { return repositoryId.split("/")[0] ?? repositoryId; }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function addArchitectureHistory(entry: ArchitectureHistoryEntry, options?: ArchitectureHistoryOptions): void;
export function addArchitectureHistory(entry: ArchitectureHistoryEntry,
  options: ArchitectureHistoryOptions = {}): MaybePromise<void> {
  const revision = options.repositoryRevision ?? "legacy";
  const key = options.idempotencyKey ?? digest(JSON.stringify({ revision, report: entry.report }));
  return mapMaybePromise(repositoryHistoryStore.insertIntelligence({
    recordId: `arch_${digest(`${entry.repositoryId}:${key}`)}`, idempotencyKey: key,
    repositoryId: entry.repositoryId, ownerId: options.ownerId ?? owner(entry.repositoryId),
    repositoryRevision: revision, intelligenceType: "architecture",
    payload: structuredClone(entry.report), model: options.model ?? null, provider: options.provider ?? null,
    generatedAt: entry.generatedAt, retentionProtected: false,
  }), () => undefined);
}
export function getArchitectureHistory(repositoryId: string, ownerId?: string,
  repositoryRevision?: string): ArchitectureHistoryEntry[];
export function getArchitectureHistory(repositoryId: string, ownerId?: string,
  repositoryRevision?: string): MaybePromise<ArchitectureHistoryEntry[]> {
  return mapMaybePromise(repositoryHistoryStore.listIntelligence({
    repositoryId, ownerId: ownerId ?? owner(repositoryId), revision: repositoryRevision,
    intelligenceType: "architecture", limit: env.REPOSITORY_HISTORY_MAX_PAGE_SIZE,
  }), (page) => page.records.map((record) => ({
    repositoryId, generatedAt: record.generatedAt, report: structuredClone(record.payload),
  })));
}
export function getLatestArchitectureHistory(repositoryId: string, ownerId?: string,
  repositoryRevision?: string): ArchitectureHistoryEntry | null;
export function getLatestArchitectureHistory(repositoryId: string, ownerId?: string,
  repositoryRevision?: string): MaybePromise<ArchitectureHistoryEntry | null> {
  return mapMaybePromise(getArchitectureHistory(repositoryId, ownerId, repositoryRevision),
    (history) => history.at(-1) ?? null);
}
export function getArchitectureHistoryCount(repositoryId: string, ownerId?: string,
  repositoryRevision?: string): number;
export function getArchitectureHistoryCount(repositoryId: string, ownerId?: string,
  repositoryRevision?: string): MaybePromise<number> {
  return mapMaybePromise(getArchitectureHistory(repositoryId, ownerId, repositoryRevision),
    (history) => history.length);
}
export function clearArchitectureHistory(repositoryId: string): void {
  if (!repositoryHistoryStore.deleteIntelligenceForTests) {
    throw new Error("Durable architecture history cannot be cleared at runtime.");
  }
  repositoryHistoryStore.deleteIntelligenceForTests(repositoryId, "architecture");
}
