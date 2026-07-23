import type { CrossEncoder } from "../../services/retrieval/hybridV2/crossEncoder.js";
import { DeterministicNoopCrossEncoder } from "../../services/retrieval/hybridV2/crossEncoder.js";
import { executeHybridRetrievalV2 } from "../../services/retrieval/hybridV2/pipeline.js";
import type { HybridRetrievalSource } from "../../services/retrieval/hybridV2/types.js";
import {
  DEFAULT_RETRIEVAL_EVALUATION_CONFIGURATIONS,
  type RetrievalEvaluationConfiguration,
} from "./configurations.js";
import {
  fixtureArtifacts,
  generateOfflineCandidates,
  loadBenchmarkSuite,
  loadRepositoryFixtureSuite,
  requirePublishedFixture,
} from "./fixtures.js";
import {
  aggregateRetrievalMetrics,
  computeRetrievalMetrics,
} from "./metrics.js";
import {
  DeterministicEvaluationCrossEncoder,
  TrackingEvaluationCrossEncoder,
} from "./rerankers.js";
import {
  compareWithBaseline,
  readBaseline,
  resultIdentity,
  type RetrievalEvaluationCaseReport,
  type RetrievalEvaluationReport,
} from "./report.js";
import type {
  RepositoryFixtureSuite,
  RetrievalBenchmarkSuite,
} from "./schema.js";

export interface RetrievalEvaluatorOptions {
  benchmarks?: RetrievalBenchmarkSuite;
  fixtures?: RepositoryFixtureSuite;
  configurations?: readonly RetrievalEvaluationConfiguration[];
  k?: number;
  now?: () => number;
  generatedAt?: () => string;
  externalCrossEncoder?: CrossEncoder;
  baselinePath?: string;
  includeBaselineComparison?: boolean;
}

function encoderForConfiguration(
  configuration: RetrievalEvaluationConfiguration,
  externalCrossEncoder?: CrossEncoder,
): {
  encoder: CrossEncoder;
  tracker: TrackingEvaluationCrossEncoder | null;
} {
  if (configuration.rerankerStrategy === "none") {
    return { encoder: new DeterministicNoopCrossEncoder(), tracker: null };
  }
  const delegate = configuration.rerankerStrategy === "external"
    ? externalCrossEncoder
    : new DeterministicEvaluationCrossEncoder();
  if (!delegate) {
    throw new Error("External reranker evaluation requires an explicit cross-encoder.");
  }
  const tracker = new TrackingEvaluationCrossEncoder(delegate);
  return { encoder: tracker, tracker };
}

function candidateSources(
  configuration: RetrievalEvaluationConfiguration,
): Set<HybridRetrievalSource> {
  return new Set(configuration.sources);
}

export async function evaluateRetrievalBenchmarks(
  options: RetrievalEvaluatorOptions = {},
): Promise<RetrievalEvaluationReport> {
  const benchmarks = options.benchmarks ?? await loadBenchmarkSuite();
  const fixtures = options.fixtures ?? await loadRepositoryFixtureSuite();
  const configurations = [...(
    options.configurations ?? DEFAULT_RETRIEVAL_EVALUATION_CONFIGURATIONS
  )].sort((left, right) => left.id.localeCompare(right.id));
  const k = Math.max(1, Math.trunc(options.k ?? 5));
  const now = options.now ?? (() => performance.now());
  const configurationReports = [];

  for (const configuration of configurations) {
    const { encoder, tracker } = encoderForConfiguration(
      configuration,
      options.externalCrossEncoder,
    );
    await encoder.verify();
    const allowedSources = candidateSources(configuration);
    const cases: RetrievalEvaluationCaseReport[] = [];
    for (const benchmark of [...benchmarks.cases].sort((left, right) =>
      left.benchmarkId.localeCompare(right.benchmarkId))) {
      const fixture = requirePublishedFixture(
        fixtures,
        benchmark.repositoryFixture,
        benchmark.repositoryRevision,
      );
      const candidates = generateOfflineCandidates(fixture, benchmark.query)
        .filter((candidate) => allowedSources.has(candidate.source));
      const attemptsBefore = tracker?.counters.attempts ?? 0;
      const failuresBefore = tracker?.counters.failures ?? 0;
      const fallbacksBefore = tracker?.counters.fallbacks ?? 0;
      const startedAt = now();
      const output = await executeHybridRetrievalV2({
        query: benchmark.query,
        repositoryId: fixture.repositoryId,
        repositoryRevision: fixture.repositoryRevision,
        candidates,
        artifacts: fixtureArtifacts(fixture),
        limit: k,
      }, {
        config: configuration.retrieval,
        crossEncoder: encoder,
      });
      const latencyMs = Math.max(0, now() - startedAt);
      const metrics = computeRetrievalMetrics(benchmark, output.results, k, {
        latencyMs,
        rerankerAttempts: (tracker?.counters.attempts ?? 0) - attemptsBefore,
        rerankerFailures: (tracker?.counters.failures ?? 0) - failuresBefore,
        rerankerFallbacks: (tracker?.counters.fallbacks ?? 0) - fallbacksBefore,
      });
      const failures: string[] = [];
      if (metrics.recallAtK < 0.5) {
        failures.push(`Recall@${k} below 0.5 (${metrics.recallAtK.toFixed(3)}).`);
      }
      const excluded = output.results
        .map((result) => result.filePath)
        .filter((filePath) => benchmark.excludedFiles.includes(filePath));
      if (excluded.length > 0) {
        failures.push(`Excluded files returned: ${[...new Set(excluded)].sort().join(", ")}.`);
      }
      cases.push({
        benchmarkId: benchmark.benchmarkId,
        category: benchmark.category,
        difficulty: benchmark.difficulty,
        repositoryFixture: fixture.fixtureId,
        repositoryRevision: fixture.repositoryRevision,
        embeddingVersion: fixture.embedding.embeddingVersion,
        metrics,
        resultIds: output.results.map(resultIdentity),
        resultFiles: output.results.map((result) => result.filePath),
        failures,
        diagnostics: output.diagnostics,
      });
    }
    configurationReports.push({
      configuration,
      aggregate: aggregateRetrievalMetrics(cases.map((item) => item.metrics)),
      cases,
    });
  }

  const report: RetrievalEvaluationReport = {
    schemaVersion: 1,
    benchmarkVersion: benchmarks.benchmarkVersion,
    generatedAt: options.generatedAt?.() ?? new Date().toISOString(),
    k,
    configurations: configurationReports,
  };
  if (options.includeBaselineComparison !== false) {
    const baseline = await readBaseline(options.baselinePath);
    if (baseline) report.baselineComparison = compareWithBaseline(report, baseline);
  }
  return report;
}
