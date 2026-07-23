import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HybridRetrievalDiagnostics } from "../../services/retrieval/hybridV2/types.js";
import type { RetrievalResult } from "../../services/retrieval/types.js";
import type { RetrievalEvaluationConfiguration } from "./configurations.js";
import type { RetrievalQualityMetrics } from "./metrics.js";

export interface RetrievalEvaluationCaseReport {
  benchmarkId: string;
  category?: string;
  difficulty?: string;
  repositoryFixture: string;
  repositoryRevision: string;
  embeddingVersion: string;
  metrics: RetrievalQualityMetrics;
  resultIds: string[];
  resultFiles: string[];
  failures: string[];
  diagnostics: HybridRetrievalDiagnostics;
}

export interface RetrievalEvaluationConfigurationReport {
  configuration: RetrievalEvaluationConfiguration;
  aggregate: RetrievalQualityMetrics;
  cases: RetrievalEvaluationCaseReport[];
}

export interface RetrievalMetricDelta {
  current: number;
  baseline: number;
  delta: number;
}

export interface RetrievalBaselineComparison {
  baselineVersion: string;
  configurations: Record<string, Partial<Record<keyof RetrievalQualityMetrics, RetrievalMetricDelta>>>;
}

export interface RetrievalEvaluationReport {
  schemaVersion: 1;
  benchmarkVersion: string;
  generatedAt: string;
  k: number;
  configurations: RetrievalEvaluationConfigurationReport[];
  baselineComparison?: RetrievalBaselineComparison;
}

export interface RetrievalBaselineReport {
  schemaVersion: 1;
  benchmarkVersion: string;
  generatedAt: string;
  configurations: Record<string, RetrievalQualityMetrics>;
}

export const DEFAULT_REPORT_PATH = path.resolve(
  ".reports/retrieval-evaluation.json",
);
export const DEFAULT_BASELINE_PATH = path.resolve(
  "evaluation/retrieval/baselines/hybrid-v2.json",
);

export function resultIdentity(result: RetrievalResult): string {
  return result.chunkId ??
    `${result.repository}:${result.filePath}:${result.startLine}:${result.endLine}`;
}

export function toBaselineReport(
  report: RetrievalEvaluationReport,
): RetrievalBaselineReport {
  return {
    schemaVersion: 1,
    benchmarkVersion: report.benchmarkVersion,
    generatedAt: report.generatedAt,
    configurations: Object.fromEntries(report.configurations.map((configuration) => [
      configuration.configuration.id,
      { ...configuration.aggregate },
    ])),
  };
}

export async function readBaseline(
  baselinePath = DEFAULT_BASELINE_PATH,
): Promise<RetrievalBaselineReport | null> {
  try {
    return JSON.parse(await readFile(baselinePath, "utf8")) as RetrievalBaselineReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function compareWithBaseline(
  report: RetrievalEvaluationReport,
  baseline: RetrievalBaselineReport,
): RetrievalBaselineComparison {
  const configurations: RetrievalBaselineComparison["configurations"] = {};
  for (const current of report.configurations) {
    const previous = baseline.configurations[current.configuration.id];
    if (!previous) continue;
    configurations[current.configuration.id] = Object.fromEntries(
      (Object.keys(current.aggregate) as Array<keyof RetrievalQualityMetrics>).map((metric) => [
        metric,
        {
          current: current.aggregate[metric],
          baseline: previous[metric],
          delta: current.aggregate[metric] - previous[metric],
        },
      ]),
    );
  }
  return {
    baselineVersion: baseline.benchmarkVersion,
    configurations,
  };
}

export async function writeEvaluationReport(
  report: RetrievalEvaluationReport,
  reportPath = DEFAULT_REPORT_PATH,
): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function updateBaseline(
  report: RetrievalEvaluationReport,
  options: {
    baselinePath?: string;
    confirm?: boolean;
    overwrite?: boolean;
  } = {},
): Promise<void> {
  if (!options.confirm) {
    throw new Error("Baseline update requires --confirm.");
  }
  const baselinePath = options.baselinePath ?? DEFAULT_BASELINE_PATH;
  const existing = await readBaseline(baselinePath);
  if (existing && !options.overwrite) {
    throw new Error("Baseline exists; pass --overwrite to replace it.");
  }
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(
    baselinePath,
    `${JSON.stringify(toBaselineReport(report), null, 2)}\n`,
    "utf8",
  );
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

export function terminalEvaluationSummary(report: RetrievalEvaluationReport): string {
  const lines = [
    `Retrieval evaluation: ${report.benchmarkVersion} (${report.k === 1 ? "K=1" : `K=${report.k}`})`,
  ];
  for (const item of report.configurations) {
    const failedCases = item.cases.filter((entry) => entry.failures.length > 0);
    const deltas = report.baselineComparison
      ?.configurations[item.configuration.id];
    lines.push(
      [
        item.configuration.id,
        `recall=${percentage(item.aggregate.recallAtK)}`,
        `mrr=${item.aggregate.mrr.toFixed(3)}`,
        `ndcg=${item.aggregate.ndcgAtK.toFixed(3)}`,
        `diversity=${percentage(item.aggregate.fileDiversity)}`,
        `duplicates=${percentage(item.aggregate.duplicateRate)}`,
        `failed_cases=${failedCases.length}`,
        ...(deltas
          ? [
              `delta_recall=${signed(deltas.recallAtK?.delta ?? 0)}`,
              `delta_mrr=${signed(deltas.mrr?.delta ?? 0)}`,
              `delta_ndcg=${signed(deltas.ndcgAtK?.delta ?? 0)}`,
            ]
          : []),
      ].join(" "),
    );
    for (const failure of failedCases) {
      lines.push(`  ${failure.benchmarkId}: ${failure.failures.join("; ")}`);
    }
  }
  return lines.join("\n");
}
