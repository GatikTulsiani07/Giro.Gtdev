import { stableId } from "../repositoryExecution/determinism.js";
import type {
  CreateRepositorySpecificationInput, RepositorySpecificationType,
} from "./types.js";

const patterns: Readonly<Record<RepositorySpecificationType, RegExp[]>> = {
  feature: [/\bfeature\b/, /\badd\b/, /\bintroduce\b/, /\bimplement\b/,
    /\bsupport\b/, /\benable\b/],
  "bug-fix": [/\bbug\b/, /\bfix\b/, /\bdefect\b/, /\bbroken\b/,
    /\bfail(?:ure|ing)?\b/, /\bincorrect\b/],
  refactor: [/\brefactor\b/, /\brestructure\b/, /\bcleanup\b/,
    /\bextract\b/, /\bdecoupl/],
  api: [/\bapi\b/, /\bendpoint\b/, /\broute\b/, /\bcontract\b/,
    /\brequest\b.*\bresponse\b/],
  architecture: [/\barchitecture\b/, /\bmodule boundary\b/, /\bcoupling\b/,
    /\blayer\b/, /\bcyclic dependenc/],
  migration: [/\bmigrat(?:e|ion)\b/, /\bupgrade\b/, /\bbackfill\b/,
    /\bschema change\b/, /\bdependency update\b/],
  security: [/\bsecurity\b/, /\bvulnerab/, /\bauth(?:entication|orization)?\b/,
    /\bpermission\b/, /\binjection\b/, /\bsecret\b/],
  performance: [/\bperformance\b/, /\boptim(?:ize|ization)\b/, /\blatency\b/,
    /\bthroughput\b/, /\bslow\b/, /\bcach(?:e|ing)\b/],
  testing: [/\btest(?:ing|s)?\b/, /\bcoverage\b/, /\bfixture\b/,
    /\bvalidation suite\b/],
};

const precedence: readonly RepositorySpecificationType[] = [
  "security", "bug-fix", "migration", "api", "performance", "testing",
  "architecture", "refactor", "feature",
];

export const normalizeSpecificationObjective = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase()
    .replace(/\s+/g, " ").replace(/[.!?]+$/g, "");

export function classifyRepositorySpecification(value: string) {
  const normalized = normalizeSpecificationObjective(value);
  const scores = Object.fromEntries(Object.entries(patterns).map(
    ([type, rules]) => [type, rules.reduce(
      (score, rule) => score + Number(rule.test(normalized)), 0)],
  )) as Record<RepositorySpecificationType, number>;
  const maximum = Math.max(...Object.values(scores));
  const type = precedence.find((item) => scores[item] === maximum) ?? "feature";
  const confidence = maximum === 0 ? 0.45 :
    Number(Math.min(0.98, 0.62 + maximum * 0.12).toFixed(2));
  return { type, confidence, scores };
}

export function deterministicSpecificationId(
  input: CreateRepositorySpecificationInput,
) {
  return stableId("repository_specification", {
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    taskId: input.taskId ?? null,
    workflowId: input.workflowId ?? null,
    objective: normalizeSpecificationObjective(input.objective),
  });
}
