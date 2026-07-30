import { stableId } from "../repositoryExecution/determinism.js";
import type {
  QueryContextSelector, QueryEngineName, QueryIntent, QueryPlanStep,
  RepositoryQueryPlan,
} from "./types.js";

const engineOrder: readonly QueryEngineName[] = [
  "Repository Intelligence", "Semantic Code Intelligence",
  "Feature Intelligence", "Change Intelligence", "Repository Knowledge",
  "Workflow Orchestrator",
];
const intentEngines: Readonly<Record<QueryIntent, readonly QueryEngineName[]>> = {
  architecture: ["Repository Intelligence"],
  feature: ["Semantic Code Intelligence", "Feature Intelligence"],
  semantic: ["Semantic Code Intelligence"],
  symbol: ["Semantic Code Intelligence"],
  dependency: ["Repository Intelligence", "Semantic Code Intelligence", "Feature Intelligence"],
  implementation: ["Repository Intelligence", "Semantic Code Intelligence", "Feature Intelligence", "Change Intelligence"],
  navigation: ["Repository Intelligence", "Semantic Code Intelligence", "Feature Intelligence"],
  "change impact": ["Repository Intelligence", "Semantic Code Intelligence", "Feature Intelligence", "Change Intelligence"],
  workflow: ["Workflow Orchestrator"],
  knowledge: ["Repository Knowledge"],
  "repository overview": ["Repository Intelligence", "Feature Intelligence"],
};

function quotedValue(query: string): string | null {
  return query.match(/["'`](.+?)["'`]/)?.[1]?.trim() ?? null;
}

export function extractQuerySelectors(
  normalizedQuery: string,
  workflowId?: string,
): readonly QueryContextSelector[] {
  const selectors: QueryContextSelector[] = [{ kind: "repository", value: "*" }];
  const path = normalizedQuery.match(/\b(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]+\b/)?.[0];
  if (path) selectors.push({ kind: "file", value: path });
  const api = normalizedQuery.match(
    /(?:^|\s)(?:(?:get|post|put|patch|delete)\s+)?(\/[a-z0-9_/:.-]+)/)?.[1];
  if (api) selectors.push({ kind: "API", value: api });
  const feature = normalizedQuery.match(/\b(?:show|explain|where does)\s+(?:the\s+)?([a-z][\w-]+)(?:\s+feature)?\s+(?:flow|start)/)?.[1];
  if (feature) selectors.push({ kind: "feature", value: feature });
  const symbol = quotedValue(normalizedQuery) ??
    normalizedQuery.match(/\b(?:function|interface|class|symbol|service)\s+([a-z_$][\w$.-]*)/)?.[1] ??
    normalizedQuery.match(/\bwhat calls\s+([a-z_$][\w$.-]*)/)?.[1];
  if (symbol) selectors.push({ kind: "symbol", value: symbol });
  const module = normalizedQuery.match(/\bmodule\s+([a-z0-9_./-]+)/)?.[1];
  if (module) selectors.push({ kind: "module", value: module });
  const knowledge = normalizedQuery.match(
    /\b(?:knowledge|decision|convention|pattern|documentation)\s+(?:about|for|on)\s+(.+?)(?:\?|$)/)?.[1];
  if (knowledge) selectors.push({ kind: "knowledge", value: knowledge.trim() });
  if (workflowId) selectors.push({ kind: "workflow", value: workflowId });
  return [...new Map(selectors.map((item) => [`${item.kind}\0${item.value}`, item])).values()];
}

export function buildRepositoryQueryPlan(
  queryId: string,
  intents: readonly QueryIntent[],
  normalizedQuery: string,
  workflowId?: string,
): RepositoryQueryPlan {
  const required = new Set(intents.flatMap((intent) => intentEngines[intent]));
  const steps: QueryPlanStep[] = engineOrder.filter((engine) => required.has(engine))
    .map((engine, position) => ({
      position, engine, required: engine !== "Repository Knowledge" &&
        engine !== "Workflow Orchestrator",
      reason: intents.filter((intent) => intentEngines[intent].includes(engine)).join(", "),
    }));
  const selectors = extractQuerySelectors(normalizedQuery, workflowId);
  return {
    planId: stableId("query_plan", { queryId, steps, selectors }),
    queryId, steps, selectors,
  };
}
