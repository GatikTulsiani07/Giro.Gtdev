import { env } from "../../../config/env.js";
import { logger } from "../../../lib/logger.js";
import { runtimeMetrics } from "../../../observability/metrics.js";
import { getRepositorySummary } from "../../repositorySummary/runtimeRepositorySummary.js";
import { getRuntimeQueryExpansionMetadata } from "../queryExpansion/runtimeQueryExpansion.js";
import type { RetrievalResult } from "../types.js";
import { rankWeightedHybridCandidates } from "./weightedHybridRanker.js";
import type {
  RankingLogger,
  RankingMetrics,
  RankingWeights,
  WeightedRankingCandidate,
  WeightedRankingResult,
} from "./rankingTypes.js";
import type { PublishedRepositoryArtifacts } from "../../repository/artifacts/repositoryArtifactStore.js";

export const runtimeRankingWeights: Readonly<RankingWeights> = Object.freeze({
  semantic: env.RANK_SEMANTIC_WEIGHT,
  keyword: env.RANK_KEYWORD_WEIGHT,
  symbol: env.RANK_SYMBOL_WEIGHT,
  graph: env.RANK_GRAPH_WEIGHT,
  summary: env.RANK_SUMMARY_WEIGHT,
  entrypoint: env.RANK_ENTRYPOINT_WEIGHT,
  stitchBonus: env.RANK_STITCH_BONUS,
  diversityBonus: env.RANK_DIVERSITY_BONUS,
  duplicatePenalty: env.RANK_DUPLICATE_PENALTY,
});

export interface RuntimeRankingCandidate {
  result: RetrievalResult;
  isExpanded: boolean;
}

export interface RuntimeWeightedRankingInput {
  repositoryId: string;
  repositoryVersion: string;
  candidates: readonly RuntimeRankingCandidate[];
  graphNodes: ReadonlyMap<string, number> | null;
  expandedScoreMultiplier: number;
  limit: number;
  artifacts?: PublishedRepositoryArtifacts | null;
}

export interface RuntimeWeightedRankingOptions {
  metrics?: RankingMetrics;
  logger?: RankingLogger;
  weights?: RankingWeights;
  now?: () => number;
  stitchingLineGap?: number;
}

function boundedCount(value: number): number {
  return Math.min(1_000_000, Math.max(0, Math.trunc(value)));
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function versionMatches(metadataVersion: string, retrievalVersion: string): boolean {
  return metadataVersion === retrievalVersion || retrievalVersion.startsWith(`${metadataVersion}:`);
}

function metadataImportance(
  repositoryId: string,
  repositoryVersion: string,
  artifacts?: PublishedRepositoryArtifacts | null,
) {
  const storedSummary = artifacts?.summary ?? getRepositorySummary(repositoryId);
  const summary = storedSummary && versionMatches(storedSummary.repositoryVersion, repositoryVersion)
    ? storedSummary
    : null;
  const expansionMetadata = getRuntimeQueryExpansionMetadata(repositoryId, repositoryVersion, artifacts);
  const summaryPaths = new Set<string>();
  const summaryNames = new Set<string>();
  const entrypoints = new Set<string>();
  const importantFiles = new Set<string>();

  if (summary) {
    const categories = [
      summary.modules,
      summary.services,
      summary.apiSurface,
      summary.authentication,
      summary.retrieval,
      summary.indexing,
      summary.applications,
      summary.libraries,
    ];
    for (const item of categories.flat()) {
      summaryNames.add(item.name.toLowerCase());
      if (item.path) summaryPaths.add(normalizePath(item.path));
    }
    for (const item of summary.entrypoints) {
      entrypoints.add(item.name.toLowerCase());
      if (item.path) entrypoints.add(normalizePath(item.path));
    }
    for (const path of [
      ...summary.dependencyOverview.centralModules,
      ...summary.dependencyOverview.dependencyHotspots,
    ]) importantFiles.add(normalizePath(path));
  }

  const exportedByFile = new Set(
    expansionMetadata.symbols
      .filter((symbol) => symbol.exported)
      .map((symbol) => normalizePath(symbol.filePath)),
  );
  const exportedByFileAndName = new Set(
    expansionMetadata.symbols
      .filter((symbol) => symbol.exported)
      .map((symbol) => `${normalizePath(symbol.filePath)}\u0000${symbol.name.toLowerCase()}`),
  );

  return { summaryPaths, summaryNames, entrypoints, importantFiles, exportedByFile, exportedByFileAndName };
}

function adjacentLocationKeys(
  candidates: readonly RuntimeRankingCandidate[],
  configuredLineGap: number,
): Set<string> {
  const byFile = new Map<string, RuntimeRankingCandidate[]>();
  for (const candidate of candidates) {
    const result = candidate.result;
    const key = `${result.repository}\u0000${normalizePath(result.filePath)}`;
    const group = byFile.get(key);
    if (group) group.push(candidate);
    else byFile.set(key, [candidate]);
  }
  const adjacent = new Set<string>();
  for (const group of byFile.values()) {
    const ordered = [...group].sort((left, right) =>
      left.result.startLine - right.result.startLine ||
      left.result.endLine - right.result.endLine
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!.result;
      const current = ordered[index]!.result;
      if (previous.startLine === current.startLine && previous.endLine === current.endLine) continue;
      const gap = current.startLine - previous.endLine - 1;
      if (gap > configuredLineGap) continue;
      adjacent.add(JSON.stringify([previous.repository, previous.filePath, previous.startLine, previous.endLine]));
      adjacent.add(JSON.stringify([current.repository, current.filePath, current.startLine, current.endLine]));
    }
  }
  return adjacent;
}

function toWeightedCandidates(
  input: RuntimeWeightedRankingInput,
  configuredLineGap: number,
): WeightedRankingCandidate[] {
  const metadata = metadataImportance(input.repositoryId, input.repositoryVersion, input.artifacts);
  const adjacent = adjacentLocationKeys(input.candidates, configuredLineGap);
  return input.candidates.map((candidate) => {
    const result = candidate.result;
    const path = normalizePath(result.filePath);
    const name = result.symbol?.toLowerCase();
    const validCitation = Boolean(
      result.repository === input.repositoryId &&
      path &&
      result.language.trim() &&
      Number.isInteger(result.startLine) &&
      Number.isInteger(result.endLine) &&
      result.startLine >= 1 &&
      result.endLine >= result.startLine,
    );
    const isEntrypoint = metadata.entrypoints.has(path) ||
      metadata.entrypoints.has(path.split("/").at(-1)?.toLowerCase() ?? "");
    const isSummaryRelevant = metadata.summaryPaths.has(path) ||
      Boolean(name && metadata.summaryNames.has(name));
    const isExported = name
      ? metadata.exportedByFileAndName.has(`${path}\u0000${name}`)
      : metadata.exportedByFile.has(path);
    const pathImportance = metadata.importantFiles.has(path) ||
      /(^|\/)(routes?|controllers?|handlers?|services?|lib|utils?)(\/|$)/i.test(path);
    const graph = input.graphNodes?.get(result.filePath);

    return {
      result: {
        ...result,
        signals: {
          ...result.signals,
          ...(graph === undefined ? {} : { graph }),
        },
      },
      expandedScoreMultiplier: candidate.isExpanded ? input.expandedScoreMultiplier : 1,
      summaryRelevance: isSummaryRelevant ? 1 : 0,
      entrypointImportance: isEntrypoint ? 1 : 0,
      exportedSymbolImportance: isExported ? 1 : 0,
      fileImportance: pathImportance ? 1 : 0,
      adjacentStitchPotential: adjacent.has(JSON.stringify([
        result.repository,
        result.filePath,
        result.startLine,
        result.endLine,
      ])) ? 1 : 0,
      citationConfidence: validCitation ? 1 : 0,
    };
  });
}

export function rankRuntimeHybridCandidates(
  input: RuntimeWeightedRankingInput,
  options: RuntimeWeightedRankingOptions = {},
): WeightedRankingResult {
  const rankingMetrics = options.metrics ?? runtimeMetrics;
  const rankingLogger = options.logger ?? logger;
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  rankingLogger.info("ranking_started", {
    candidateCount: boundedCount(input.candidates.length),
    repositoryCount: input.repositoryId.trim() ? 1 : 0,
  });

  const result = rankWeightedHybridCandidates({
    candidates: toWeightedCandidates(
      input,
      options.stitchingLineGap ?? env.RETRIEVAL_STITCH_LINE_GAP,
    ),
    weights: options.weights ?? runtimeRankingWeights,
    limit: input.limit,
  });
  const durationMs = Math.min(60_000, Math.max(0, now() - startedAt));
  rankingMetrics.incrementRankingOperations();
  rankingMetrics.incrementRankingCandidates(input.candidates.length);
  rankingMetrics.observeRankingDurationMs(durationMs);
  rankingLogger.info("ranking_completed", {
    candidateCount: boundedCount(input.candidates.length),
    rankedCount: boundedCount(result.ranked.length),
    duplicateCount: boundedCount(result.duplicateCount),
    durationMs: Math.round(durationMs),
  });
  return result;
}

export function recordRuntimeRankingCacheHit(
  candidateCount: number,
  options: Pick<RuntimeWeightedRankingOptions, "logger"> = {},
): void {
  (options.logger ?? logger).info("ranking_cache_hit", {
    candidateCount: boundedCount(candidateCount),
  });
}
