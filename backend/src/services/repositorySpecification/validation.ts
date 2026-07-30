import {
  REPOSITORY_SPECIFICATION_ENGINE_VERSION,
  REPOSITORY_SPECIFICATION_SCHEMA_VERSION,
  RepositorySpecificationError,
  type RepositoryEngineeringSpecification,
} from "./types.js";

const kinds = [
  "preparation", "implementation", "verification", "testing", "review",
  "rollout", "post-deployment validation",
];

export function validateRepositoryEngineeringSpecification(
  value: RepositoryEngineeringSpecification,
) {
  const record = value.specification;
  const phaseIds = new Set(value.implementationPhases.map(
    (item) => item.phaseId));
  const forbidden = /```|(?:^|\s)(?:function|class|const|let|var)\s+\w+\s*(?:[=({:]|=>)|(?:^|\s)(?:import|export)\s+/i;
  const text = [
    record.objective, ...record.scope, ...record.assumptions,
    ...record.constraints,
    ...value.implementationPhases.flatMap((item) =>
      [item.objective, ...item.actions]),
    ...value.acceptanceCriteria.functionalRequirements,
    ...value.acceptanceCriteria.nonFunctionalRequirements,
    ...value.testStrategy.unitTestingPlan,
    ...value.testStrategy.integrationTestingPlan,
  ];
  if (!record.specificationId ||
      record.schemaVersion !== REPOSITORY_SPECIFICATION_SCHEMA_VERSION ||
      !record.tenantId || !record.ownerId || !record.repositoryId ||
      !/^[0-9a-f]{40}$/.test(record.repositoryRevision) ||
      !record.title || !record.objective ||
      record.confidence < 0 || record.confidence > 1 ||
      !record.ownershipFingerprint ||
      value.orchestrationLatencyMs < 0 || value.recoveryCount < 0 ||
      (["published", "partial"].includes(record.lifecycle) &&
        value.implementationPhases.length !== kinds.length) ||
      value.implementationPhases.some((phase, position) =>
        phase.position !== position || phase.kind !== kinds[position] ||
        !phase.phaseId || !phase.objective || phase.actions.length === 0 ||
        phase.evidenceReferences.length === 0 ||
        phase.dependsOn.some((id) => !phaseIds.has(id)) ||
        phase.dependsOn.some((id) =>
          value.implementationPhases.findIndex(
            (candidate) => candidate.phaseId === id) >= position)) ||
      phaseIds.size !== value.implementationPhases.length ||
      Object.values(value.risks).some((risk) =>
        risk.score < 0 || risk.score > 100 || !risk.summary) ||
      value.acceptanceCriteria.functionalRequirements.length === 0 ||
      value.acceptanceCriteria.nonFunctionalRequirements.length === 0 ||
      value.acceptanceCriteria.validationChecklist.length === 0 ||
      value.acceptanceCriteria.successCriteria.length === 0 ||
      Object.values(value.testStrategy).some((items) => items.length === 0) ||
      text.some((item) => forbidden.test(item))) {
    throw new RepositorySpecificationError(
      "repository_specification_invalid",
      "Specification structure, lineage, evidence, or no-source-code contract is invalid.",
      { engineVersion: REPOSITORY_SPECIFICATION_ENGINE_VERSION });
  }
}

export const cloneSpecification = <T>(value: T): T => structuredClone(value);
