import type { GroundedCitation, IndexedRepository, Session } from "@/types/api";

export const repository: IndexedRepository = {
  owner: "acme", repo: "platform", status: "indexed", indexedAt: "2026-07-16T10:00:00.000Z", lastAccessedAt: null,
  chunkCount: 120, fileCount: 42, symbolCount: 88, graphNodeCount: 57, graphEdgeCount: 93, summaryAvailable: true,
  firstIndexedAt: "2026-07-16T10:00:00.000Z", lastIndexedAt: "2026-07-16T10:00:00.000Z", totalIndexedFiles: 42,
  lastIndexMode: "full", lastChangedFileCount: 42, lastFailureAt: null, failureReason: null, failedFileCount: 0, retryCount: 0, lastRetryAt: null,
};

export const citation: GroundedCitation = {
  repositoryId: "acme/platform", relativeFilePath: "src/auth/login.ts", language: "typescript", chunkId: "chunk-1",
  startLine: 10, endLine: 24, retrievalType: "symbol", score: 0.91, symbol: "authenticate", repositoryVersion: "job-1:1",
};

export const session: Session = {
  id: "session-1", userId: "user-1", owner: "acme", repo: "platform", title: "Platform exploration",
  createdAt: "2026-07-16T10:00:00.000Z", updatedAt: "2026-07-16T10:10:00.000Z", messages: [], selectedContext: [],
};
