import type { RetrievalQualityMetrics } from "./metrics.js";
import type { RetrievalEvaluationReport } from "./report.js";

export interface RetrievalRegressionThresholds {
  configurationId: string;
  minimumRecallAtK?: number;
  minimumMrr?: number;
  minimumNdcgAtK?: number;
  minimumFileDiversity?: number;
  maximumDuplicateRate?: number;
  maximumLatencyMs?: number;
}

export interface RetrievalRegressionFailure {
  metric: keyof RetrievalQualityMetrics;
  expected: string;
  actual: number;
}

export function evaluateRegressionThresholds(
  report: RetrievalEvaluationReport,
  thresholds: RetrievalRegressionThresholds,
): RetrievalRegressionFailure[] {
  const configuration = report.configurations.find(
    (candidate) => candidate.configuration.id === thresholds.configurationId,
  );
  if (!configuration) {
    throw new Error(`Configuration ${thresholds.configurationId} is missing from the report.`);
  }
  const failures: RetrievalRegressionFailure[] = [];
  const minimums: Array<[
    keyof RetrievalQualityMetrics,
    number | undefined,
  ]> = [
    ["recallAtK", thresholds.minimumRecallAtK],
    ["mrr", thresholds.minimumMrr],
    ["ndcgAtK", thresholds.minimumNdcgAtK],
    ["fileDiversity", thresholds.minimumFileDiversity],
  ];
  for (const [metric, minimum] of minimums) {
    if (minimum !== undefined && configuration.aggregate[metric] < minimum) {
      failures.push({
        metric,
        expected: `>= ${minimum}`,
        actual: configuration.aggregate[metric],
      });
    }
  }
  if (
    thresholds.maximumDuplicateRate !== undefined &&
    configuration.aggregate.duplicateRate > thresholds.maximumDuplicateRate
  ) {
    failures.push({
      metric: "duplicateRate",
      expected: `<= ${thresholds.maximumDuplicateRate}`,
      actual: configuration.aggregate.duplicateRate,
    });
  }
  if (
    thresholds.maximumLatencyMs !== undefined &&
    configuration.aggregate.latencyMs > thresholds.maximumLatencyMs
  ) {
    failures.push({
      metric: "latencyMs",
      expected: `<= ${thresholds.maximumLatencyMs}`,
      actual: configuration.aggregate.latencyMs,
    });
  }
  return failures;
}

export function regressionExitCode(
  report: RetrievalEvaluationReport,
  thresholds: RetrievalRegressionThresholds,
): number {
  return evaluateRegressionThresholds(report, thresholds).length > 0 ? 1 : 0;
}
