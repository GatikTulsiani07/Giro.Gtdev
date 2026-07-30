import { stableId } from "../repositoryExecution/determinism.js";
import type { RepositoryTaskPlan } from "../repositoryTaskPlanner/types.js";
import {
  REPOSITORY_SPECIFICATION_SCHEMA_VERSION,
  type EngineeringSpecificationRecord,
  type RepositoryEngineeringSpecification,
  type RepositorySpecificationType,
  type SpecificationImplementationPhase,
  type SpecificationPhaseKind,
  type SpecificationRisk,
} from "./types.js";

const unique = (values: readonly string[]) =>
  [...new Set(values.filter(Boolean))].sort();

export interface BuildSpecificationInput {
  record: EngineeringSpecificationRecord;
  taskPlan: RepositoryTaskPlan;
  diagnostics?: RepositoryEngineeringSpecification["diagnostics"];
  latencyMs?: number;
}

const phaseKinds: readonly SpecificationPhaseKind[] = [
  "preparation", "implementation", "verification", "testing", "review",
  "rollout", "post-deployment validation",
];

function risk(score: number, summary: string, evidence: readonly string[]):
SpecificationRisk {
  const bounded = Number(Math.max(0, Math.min(100, score)).toFixed(2));
  return {
    score: bounded,
    level: bounded >= 80 ? "critical" : bounded >= 60 ? "high" :
      bounded >= 35 ? "medium" : "low",
    summary,
    evidence: unique(evidence),
  };
}

function phaseActions(
  kind: SpecificationPhaseKind,
  plan: RepositoryTaskPlan,
) {
  const files = plan.impact.affectedFiles;
  const common = files.length > 0
    ? [`Keep changes within the identified file set: ${files.join(", ")}.`]
    : ["Confirm the concrete change boundary before implementation begins."];
  const actions: Record<SpecificationPhaseKind, string[]> = {
    preparation: [
      "Confirm repository ownership, revision, graph integrity, semantic consistency, and feature lineage.",
      "Freeze the accepted scope, assumptions, constraints, and evidence versions.",
    ],
    implementation: [
      "Execute the approved engineering change in dependency order.",
      "Preserve existing public contracts unless an explicit API change is in scope.",
    ],
    verification: [
      "Verify every affected symbol, module, dependency, and downstream consumer against the objective.",
      "Re-run semantic and feature lineage validation after the change.",
    ],
    testing: [
      ...plan.validationChecklist.requiredTests,
      "Execute focused unit, integration, and regression coverage for affected behavior.",
    ],
    review: [
      ...plan.validationChecklist.reviewChecklist,
      "Review architectural, dependency, regression, and rollout evidence.",
    ],
    rollout: [
      "Use a reversible rollout appropriate to the identified risk level.",
      "Record the deployed revision and verify operational readiness.",
    ],
    "post-deployment validation": [
      "Validate success criteria against the deployed revision.",
      "Monitor affected workflows and downstream impact for regressions.",
    ],
  };
  return unique([...common, ...actions[kind]]);
}

export function buildRepositoryEngineeringSpecification(
  input: BuildSpecificationInput,
): RepositoryEngineeringSpecification {
  const { record, taskPlan } = input;
  const evidence = unique([
    ...Object.values(taskPlan.sourceVersions),
    taskPlan.task.taskId,
    ...taskPlan.engineUsage,
  ]);
  const implementationPhases: SpecificationImplementationPhase[] = [];
  for (const [position, kind] of phaseKinds.entries()) {
    const prior = implementationPhases[position - 1];
    implementationPhases.push({
      phaseId: stableId("specification_phase", {
        specificationId: record.specificationId, position, kind,
      }),
      position,
      kind,
      title: kind.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      objective: `Complete ${kind} for ${record.type} specification ${record.specificationId}.`,
      actions: phaseActions(kind, taskPlan),
      evidenceReferences: evidence,
      dependsOn: prior ? [prior.phaseId] : [],
    });
  }
  const impact = {
    affectedFeatures: unique(taskPlan.impact.affectedFeatures),
    affectedModules: unique(taskPlan.impact.affectedModules),
    affectedFiles: unique(taskPlan.impact.affectedFiles),
    affectedSymbols: unique(taskPlan.impact.affectedSymbols),
    dependencyChain: unique(taskPlan.impact.dependencies),
    downstreamImpact: unique(taskPlan.impact.downstreamImpact),
  };
  const affected = impact.affectedFiles.length +
    impact.affectedSymbols.length + impact.affectedFeatures.length;
  const context = {
    sourceVersions: taskPlan.sourceVersions,
    repository: unique([
      `repository:${record.repositoryId}`,
      `revision:${record.repositoryRevision}`,
      ...taskPlan.engineUsage.filter((item) =>
        item === "Repository Intelligence"),
    ]),
    semantic: unique([
      `semantic-graph:${taskPlan.sourceVersions.semanticGraph}`,
      ...impact.affectedSymbols,
    ]),
    featureOwnership: unique([
      `feature-graph:${taskPlan.sourceVersions.featureGraph}`,
      ...impact.affectedFeatures,
    ]),
    architecture: unique([
      ...impact.affectedModules, ...taskPlan.risk.inputs.coupling === undefined
        ? [] : [`coupling:${taskPlan.risk.inputs.coupling}`],
    ]),
    workflows: unique([
      ...(record.workflowId ? [record.workflowId] : []),
      ...taskPlan.validationChecklist.affectedWorkflows,
    ]),
    knowledge: taskPlan.engineUsage.includes("Knowledge Engine")
      ? ["Knowledge Engine"] : [],
    evolution: taskPlan.engineUsage.includes("Evolution Intelligence")
      ? ["Evolution Intelligence"] : [],
    insights: taskPlan.engineUsage.includes("Repository Insights")
      ? ["Repository Insights"] : [],
  };
  const testFiles = impact.affectedFiles.filter((file) =>
    /(?:test|spec)\.[^.]+$/i.test(file));
  const functional = unique([
    `The delivered behavior satisfies: ${record.objective}.`,
    ...impact.affectedFeatures.map((id) =>
      `Affected feature ${id} retains its documented behavior outside the approved scope.`),
  ]);
  return {
    specification: {
      ...record,
      schemaVersion: REPOSITORY_SPECIFICATION_SCHEMA_VERSION,
    },
    context,
    impact,
    implementationPhases,
    risks: {
      architectural: risk(taskPlan.risk.architecturalRisk,
        "Architectural risk is derived from affected subsystem coupling, repository insights, and evolution signals.",
        [...impact.affectedModules, ...context.insights, ...context.evolution]),
      dependency: risk(taskPlan.risk.dependencyRisk,
        "Dependency risk is derived from graph edges and dependency depth.",
        impact.dependencyChain),
      regression: risk(taskPlan.risk.regressionRisk,
        "Regression risk is derived from downstream consumers, public symbols, and change intelligence.",
        [...impact.downstreamImpact, ...impact.affectedSymbols]),
      rollout: risk(Math.min(100,
        taskPlan.risk.overallRisk * 0.7 + affected * 1.5),
      "Rollout risk is derived from overall change risk and affected surface area.",
      [...impact.affectedFiles, ...context.workflows]),
    },
    acceptanceCriteria: {
      functionalRequirements: functional,
      nonFunctionalRequirements: unique([
        "No unintended public API contract changes are introduced.",
        "Repository ownership, revision fencing, graph integrity, semantic consistency, and feature lineage remain valid.",
        record.type === "performance"
          ? "Measured latency or throughput meets the objective without regression."
          : "Existing performance and security characteristics do not regress.",
      ]),
      validationChecklist: unique([
        ...taskPlan.validationChecklist.verificationSteps,
        "Confirm every phase is complete and linked to published evidence.",
        "Confirm no generated source code is present in this specification.",
      ]),
      successCriteria: unique([
        "All functional and non-functional requirements pass validation.",
        "All required tests pass at the fenced repository revision.",
        "No unresolved high or critical risk remains without an approved mitigation.",
      ]),
    },
    testStrategy: {
      unitTestingPlan: unique([
        ...testFiles.map((file) => `Run focused unit coverage in ${file}.`),
        "Add or update deterministic unit coverage for each affected symbol.",
      ]),
      integrationTestingPlan: unique([
        ...taskPlan.validationChecklist.affectedWorkflows.map((workflow) =>
          `Validate workflow ${workflow} end to end.`),
        "Validate boundaries between every affected module and its dependencies.",
      ]),
      regressionTestingPlan: unique([
        "Run the repository regression suite for affected features and downstream consumers.",
        ...impact.downstreamImpact.map((value) =>
          `Validate downstream behavior: ${value}.`),
      ]),
      validationSteps: unique([
        ...taskPlan.validationChecklist.verificationSteps,
        "Revalidate the repository revision and intelligence lineage before accepting results.",
      ]),
    },
    diagnostics: [...(input.diagnostics ?? []), ...taskPlan.diagnostics.map(
      (item) => ({
        code: item.code, message: item.message, severity: item.severity,
      }))],
    cacheHit: false,
    orchestrationLatencyMs: input.latencyMs ?? 0,
    recoveryCount: 0,
  };
}

export function titleForSpecification(
  type: RepositorySpecificationType,
  objective: string,
) {
  const label = type.replace("-", " ").replace(/\b\w/g,
    (letter) => letter.toUpperCase());
  const summary = objective.length > 96
    ? `${objective.slice(0, 93).trimEnd()}...` : objective;
  return `${label} Specification: ${summary}`;
}
