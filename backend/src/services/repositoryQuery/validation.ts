import { QUERY_ENGINES, QUERY_INTENTS, REPOSITORY_QUERY_SCHEMA_VERSION, RepositoryQueryError, type RepositoryQuery, type RepositoryQueryPlan, type RepositoryQueryResponse } from "./types.js";

export function validateRepositoryQuery(query: RepositoryQuery): void {
  if (!query.queryId || query.schemaVersion !== REPOSITORY_QUERY_SCHEMA_VERSION ||
      !query.tenantId || !query.userId || !query.repositoryId ||
      !/^[0-9a-f]{40}$/.test(query.repositoryRevision) ||
      !query.originalQuery.trim() || !query.normalizedQuery ||
      query.intents.length === 0 ||
      query.intents.some((intent) => !QUERY_INTENTS.includes(intent)) ||
      query.confidence < 0 || query.confidence > 1) {
    throw new RepositoryQueryError("repository_query_invalid", "Repository query is invalid.");
  }
}

export function validateRepositoryQueryPlan(plan: RepositoryQueryPlan): void {
  if (!plan.planId || !plan.queryId || plan.steps.some((step, index) =>
    step.position !== index || !QUERY_ENGINES.includes(step.engine)) ||
    new Set(plan.steps.map((step) => step.engine)).size !== plan.steps.length) {
    throw new RepositoryQueryError("repository_query_plan_invalid", "Repository query plan is invalid.");
  }
}

export function validateRepositoryQueryResponse(
  query: RepositoryQuery,
  response: RepositoryQueryResponse,
): void {
  if (response.queryId !== query.queryId ||
      response.repositoryId !== query.repositoryId ||
      response.repositoryRevision !== query.repositoryRevision ||
      response.confidence < 0 || response.confidence > 1) {
    throw new RepositoryQueryError("repository_query_response_invalid", "Repository query response is invalid.");
  }
}

export const cloneRepositoryQueryExecution = <T>(value: T): T => structuredClone(value);
