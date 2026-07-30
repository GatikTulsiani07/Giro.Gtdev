import { stableId } from "../repositoryExecution/determinism.js";
import {
  TASK_CATEGORIES, type CreateRepositoryTaskPlanInput,
  type RepositoryTaskCategory, type TaskPlanningEngine,
} from "./types.js";

const categoryPatterns: Readonly<Record<
  RepositoryTaskCategory, readonly RegExp[]
>> = {
  "bug fix": [
    /\bbug\b/, /\bfix\b/, /\bdefect\b/, /\berror\b/, /\bfail(?:ure|ing)?\b/,
    /\bincorrect\b/, /\bbroken\b/,
  ],
  "new feature": [
    /\bnew feature\b/, /\badd\b/, /\bintroduce\b/, /\bimplement\b/,
    /\bsupport\b/, /\benable\b/,
  ],
  refactor: [
    /\brefactor\b/, /\brestructure\b/, /\bcleanup\b/, /\bsimplif(?:y|ication)\b/,
    /\bextract\b/, /\breorganize\b/,
  ],
  performance: [
    /\bperformance\b/, /\boptim(?:ize|ization)\b/, /\blatency\b/,
    /\bthroughput\b/, /\bslow\b/, /\bcach(?:e|ing)\b/,
  ],
  security: [
    /\bsecurity\b/, /\bvulnerab(?:ility|le)\b/, /\bauth(?:entication|orization)?\b/,
    /\bpermission\b/, /\binjection\b/, /\btoken\b/, /\bsecret\b/,
  ],
  documentation: [
    /\bdocument(?:ation)?\b/, /\bdocs?\b/, /\breadme\b/, /\bcomment\b/,
    /\bguide\b/,
  ],
  testing: [
    /\btest(?:ing|s)?\b/, /\bcoverage\b/, /\bspec\b/, /\bfixture\b/,
    /\bregression test\b/,
  ],
  "dependency update": [
    /\bdependency\b/, /\bdependencies\b/, /\bupgrade\b/, /\bpackage\b/,
    /\bversion bump\b/, /\bupdate .+ to v?\d/,
  ],
  "API change": [
    /\bapi\b/, /\bendpoint\b/, /\broute\b/, /\bcontract\b/, /\bschema\b/,
    /\brequest\b.*\bresponse\b/,
  ],
  "architecture improvement": [
    /\barchitecture\b/, /\bmodule boundary\b/, /\bcoupling\b/,
    /\bcyclic dependenc/, /\blayer\b/, /\bdecoupl/,
  ],
};

const precedence: readonly RepositoryTaskCategory[] = [
  "security", "bug fix", "dependency update", "API change", "performance",
  "testing", "documentation", "architecture improvement", "refactor",
  "new feature",
];

export function normalizeTaskObjective(value: string) {
  return value.normalize("NFKC").trim().toLowerCase()
    .replace(/\s+/g, " ").replace(/[.!?]+$/g, "");
}

export function classifyRepositoryTask(value: string): {
  category: RepositoryTaskCategory; confidence: number;
  scores: Readonly<Record<RepositoryTaskCategory, number>>;
} {
  const normalized = normalizeTaskObjective(value);
  const scores = Object.fromEntries(TASK_CATEGORIES.map((category) => [
    category,
    categoryPatterns[category].reduce((sum, pattern) =>
      sum + Number(pattern.test(normalized)), 0),
  ])) as Record<RepositoryTaskCategory, number>;
  const maximum = Math.max(...Object.values(scores));
  const category = precedence.find((item) => scores[item] === maximum) ??
    "new feature";
  const confidence = maximum === 0 ? 0.45 :
    Number(Math.min(0.98, 0.62 + maximum * 0.12).toFixed(2));
  return { category, confidence, scores };
}

export function deterministicRepositoryTaskId(
  input: CreateRepositoryTaskPlanInput,
) {
  return stableId("repository_task", {
    tenantId: input.tenantId, ownerId: input.ownerId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    normalizedObjective: normalizeTaskObjective(input.userRequest),
  });
}

const engineOrder: readonly TaskPlanningEngine[] = [
  "Repository Intelligence", "Semantic Intelligence",
  "Feature Intelligence", "Query Engine", "Change Intelligence",
  "Repository Insights", "Evolution Intelligence", "Knowledge Engine",
  "Workflow Engine",
];

export function selectTaskPlanningEngines(
  category: RepositoryTaskCategory,
  workflowId?: string,
) {
  const selected = new Set<TaskPlanningEngine>([
    "Repository Intelligence", "Semantic Intelligence",
    "Feature Intelligence", "Query Engine", "Change Intelligence",
  ]);
  if ([
    "bug fix", "refactor", "performance", "security", "dependency update",
    "API change", "architecture improvement",
  ].includes(category)) selected.add("Repository Insights");
  if ([
    "refactor", "performance", "dependency update", "API change",
    "architecture improvement",
  ].includes(category)) selected.add("Evolution Intelligence");
  if ([
    "bug fix", "new feature", "refactor", "security", "documentation",
    "dependency update", "API change", "architecture improvement",
  ].includes(category)) selected.add("Knowledge Engine");
  if (workflowId) selected.add("Workflow Engine");
  return engineOrder.filter((engine) => selected.has(engine))
    .map((engine, position) => ({
      position, engine,
      required: [
        "Repository Intelligence", "Semantic Intelligence",
        "Feature Intelligence",
      ].includes(engine),
      reason: `${category} planning evidence`,
    }));
}
