import { stableId } from "../repositoryExecution/determinism.js";
import type { QueryIntent, RepositoryQueryInput } from "./types.js";

export function normalizeRepositoryQuery(query: string): string {
  return query.normalize("NFKC").trim().toLowerCase()
    .replaceAll(/[“”"'`]/g, "")
    .replaceAll(/\s+/g, " ");
}

const rules: ReadonlyArray<readonly [QueryIntent, RegExp]> = [
  ["change impact", /\b(what breaks|impact|affected|change|modify|remove|refactor)\b/],
  ["implementation", /\b(implement|implementation|roadmap|files should (?:i )?(?:change|edit)|how (?:do|would|should) (?:i|we))\b/],
  ["workflow", /\b(workflow|execution|approval|stage|checkpoint)\b/],
  ["repository overview", /\b(explain (?:this |the )?repository|repository overview|read first|start reading|codebase overview)\b/],
  ["architecture", /\b(architecture|architectural|subsystem|layer|around this module|module structure)\b/],
  ["feature", /\b(feature|flow|owns? this file|payment|authentication|auth flow)\b/],
  ["dependency", /\b(depend|dependency|imports?|calls?|callers?|callees?|uses?|used by)\b/],
  ["symbol", /\b(symbol|interface|class|function|method|definition|implemented|implementation of|jwt)\b/],
  ["semantic", /\b(reference|inherit|override|semantic|validated|validation)\b/],
  ["navigation", /\b(where|show|find|locate|start|entry ?point|read first)\b/],
  ["knowledge", /\b(knowledge|decision|convention|pattern|documentation|why)\b/],
];

export function classifyRepositoryQuery(query: string): {
  intents: readonly QueryIntent[]; confidence: number;
} {
  const normalized = normalizeRepositoryQuery(query);
  const intents = rules.filter(([, pattern]) => pattern.test(normalized))
    .map(([intent]) => intent);
  if (intents.length === 0) intents.push("repository overview");
  const unique = [...new Set(intents)];
  const confidence = Number(Math.min(0.99,
    0.55 + Math.min(unique.length, 4) * 0.09).toFixed(2));
  return { intents: unique, confidence };
}

export function deterministicRepositoryQueryId(
  input: Pick<RepositoryQueryInput,
    "tenantId" | "userId" | "repositoryId" | "repositoryRevision" |
    "repositoryOwnerId" | "query" | "workflowId" | "sessionId">,
): string {
  return stableId("query", {
    tenantId: input.tenantId,
    userId: input.userId,
    repositoryOwnerId: input.repositoryOwnerId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    workflowId: input.workflowId ?? null,
    sessionId: input.sessionId ?? null,
    normalizedQuery: normalizeRepositoryQuery(input.query),
  });
}
