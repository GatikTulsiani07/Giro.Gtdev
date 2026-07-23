import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { env } from "../../config/env.js";
import { OpenAICrossEncoder } from "../../services/retrieval/hybridV2/crossEncoder.js";
import {
  DEFAULT_RETRIEVAL_EVALUATION_CONFIGURATIONS,
  externalRetrievalEvaluationConfiguration,
} from "./configurations.js";
import { evaluateRetrievalBenchmarks } from "./evaluator.js";
import {
  evaluateRegressionThresholds,
  type RetrievalRegressionThresholds,
} from "./regression.js";
import {
  DEFAULT_BASELINE_PATH,
  DEFAULT_REPORT_PATH,
  terminalEvaluationSummary,
  updateBaseline,
  writeEvaluationReport,
} from "./report.js";

type EvaluationMode = "evaluate" | "regression" | "baseline" | "external";

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

async function loadThresholds(): Promise<RetrievalRegressionThresholds> {
  return JSON.parse(await readFile(
    path.resolve("evaluation/retrieval/thresholds.json"),
    "utf8",
  )) as RetrievalRegressionThresholds;
}

export async function runRetrievalEvaluationCommand(
  mode: EvaluationMode,
  args: readonly string[] = [],
): Promise<number> {
  const external = mode === "external";
  const configurations = external
    ? [externalRetrievalEvaluationConfiguration(env.RETRIEVAL_RERANKER_MODEL)]
    : DEFAULT_RETRIEVAL_EVALUATION_CONFIGURATIONS;
  const externalCrossEncoder = external
    ? new OpenAICrossEncoder(
        new OpenAI({ apiKey: env.OPENAI_API_KEY }),
        env.RETRIEVAL_RERANKER_MODEL,
      )
    : undefined;
  const report = await evaluateRetrievalBenchmarks({
    configurations,
    externalCrossEncoder,
    includeBaselineComparison: mode !== "baseline",
  });
  await writeEvaluationReport(report, DEFAULT_REPORT_PATH);
  process.stdout.write(`${terminalEvaluationSummary(report)}\n`);
  process.stdout.write(`JSON report: ${DEFAULT_REPORT_PATH}\n`);

  if (mode === "baseline") {
    await updateBaseline(report, {
      baselinePath: DEFAULT_BASELINE_PATH,
      confirm: hasFlag(args, "--confirm"),
      overwrite: hasFlag(args, "--overwrite"),
    });
    process.stdout.write(`Baseline updated: ${DEFAULT_BASELINE_PATH}\n`);
    return 0;
  }
  if (mode === "regression") {
    const failures = evaluateRegressionThresholds(report, await loadThresholds());
    for (const failure of failures) {
      process.stderr.write(
        `Regression: ${failure.metric} ${failure.expected}, actual=${failure.actual.toFixed(6)}\n`,
      );
    }
    return failures.length > 0 ? 1 : 0;
  }
  return 0;
}
