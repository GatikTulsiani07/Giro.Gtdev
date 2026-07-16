import { logger as runtimeLogger } from "../../lib/logger.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import type { RetrievalSource } from "./types.js";

export type CitationRetrievalType = RetrievalSource | "hybrid" | "file-search";

export interface Citation {
  repositoryId: string;
  relativeFilePath: string;
  language: string;
  chunkId: string;
  startLine: number;
  endLine: number;
  retrievalType: CitationRetrievalType;
  score: number;
  symbol?: string;
  repositoryVersion: string;
}

export interface CitationCandidate {
  repositoryId: string;
  filePath: string;
  language: string;
  chunkId?: string;
  startLine: number;
  endLine: number;
  retrievalType: CitationRetrievalType;
  score: number;
  symbol?: string;
  repositoryVersion: string;
}

export interface CitationMetrics {
  incrementCitationsGenerated(): void;
  addCitationChunks(count: number): void;
  addCitationMerges(count: number): void;
}

export interface CitationLogger {
  info(event: string, fields?: Record<string, unknown>): void;
}

export interface BuildCitationsOptions {
  surface: "semantic" | "keyword" | "hybrid" | "context" | "session";
  metrics?: CitationMetrics;
  logger?: CitationLogger;
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function repositoryRelativePath(
  filePath: string,
  repositoryId: string,
): string | null {
  const normalized = filePath.trim().replaceAll("\\", "/");
  if (!normalized) return null;

  const storageMarker = "/.storage/repos/";
  const markerIndex = normalized.indexOf(storageMarker);
  let relative = normalized;
  if (markerIndex >= 0) {
    const storedPath = normalized.slice(markerIndex + storageMarker.length);
    const separator = storedPath.indexOf("/");
    if (separator < 0) return null;
    relative = storedPath.slice(separator + 1);
  } else if (normalized.startsWith(".storage/repos/")) {
    const storedPath = normalized.slice(".storage/repos/".length);
    const separator = storedPath.indexOf("/");
    if (separator < 0) return null;
    relative = storedPath.slice(separator + 1);
  } else if (normalized.startsWith("/")) {
    return null;
  }

  const repositoryFolder = repositoryId.replace("/", "--");
  for (const prefix of [`${repositoryFolder}/`, `${repositoryId}/`]) {
    if (relative.startsWith(prefix)) relative = relative.slice(prefix.length);
  }
  relative = relative.replace(/^\.\//, "");
  const segments = relative.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) return null;
  return segments.join("/");
}

function toCitation(candidate: CitationCandidate): Citation | null {
  const relativeFilePath = repositoryRelativePath(
    candidate.filePath,
    candidate.repositoryId,
  );
  if (
    !relativeFilePath ||
    !candidate.repositoryId.trim() ||
    !candidate.language.trim() ||
    !candidate.repositoryVersion.trim() ||
    !Number.isInteger(candidate.startLine) ||
    !Number.isInteger(candidate.endLine) ||
    candidate.startLine < 1 ||
    candidate.endLine < candidate.startLine ||
    !Number.isFinite(candidate.score)
  ) return null;

  const citation: Citation = {
    repositoryId: candidate.repositoryId,
    relativeFilePath,
    language: candidate.language,
    chunkId: candidate.chunkId?.trim() ||
      `${relativeFilePath}:${candidate.startLine}-${candidate.endLine}`,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    retrievalType: candidate.retrievalType,
    score: roundScore(candidate.score),
    repositoryVersion: candidate.repositoryVersion,
  };
  if (candidate.symbol?.trim()) citation.symbol = candidate.symbol.trim();
  return citation;
}

function locationKey(citation: Citation): string {
  return JSON.stringify([
    citation.repositoryId,
    citation.relativeFilePath,
    citation.startLine,
    citation.endLine,
  ]);
}

export function buildCitations(
  candidates: readonly CitationCandidate[],
  options: BuildCitationsOptions,
): Citation[] {
  const metrics = options.metrics ?? runtimeMetrics;
  const citationLogger = options.logger ?? runtimeLogger;
  const merged = new Map<string, Citation>();
  let mergeCount = 0;

  for (const candidate of candidates) {
    const citation = toCitation(candidate);
    if (!citation) continue;
    const key = locationKey(citation);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, citation);
      continue;
    }
    mergeCount += 1;
    if (
      citation.score > existing.score ||
      (citation.score === existing.score &&
        citation.retrievalType.localeCompare(existing.retrievalType) < 0)
    ) {
      merged.set(key, {
        ...citation,
        symbol: citation.symbol ?? existing.symbol,
      });
    } else if (!existing.symbol && citation.symbol) {
      existing.symbol = citation.symbol;
    }
  }

  const citations = [...merged.values()].sort(
    (a, b) =>
      b.score - a.score ||
      a.relativeFilePath.localeCompare(b.relativeFilePath) ||
      a.startLine - b.startLine ||
      a.endLine - b.endLine ||
      a.chunkId.localeCompare(b.chunkId),
  );
  for (const citation of citations) Object.freeze(citation);
  Object.freeze(citations);

  metrics.incrementCitationsGenerated();
  metrics.addCitationChunks(citations.length);
  metrics.addCitationMerges(mergeCount);
  const repositoryIds = [...new Set(citations.map((citation) => citation.repositoryId))];
  citationLogger.info("citations_generated", {
    surface: options.surface,
    citationCount: citations.length,
    repositoryCount: repositoryIds.length,
  });
  if (mergeCount > 0) {
    citationLogger.info("citations_merged", {
      surface: options.surface,
      mergeCount,
      citationCount: citations.length,
    });
  }
  return citations;
}
