import { createHash } from "node:crypto";
import type {
  SemanticRelationship,
  SemanticSymbol,
} from "../semanticCodeIntelligence/types.js";
import {
  FEATURE_INTELLIGENCE_SCHEMA_VERSION,
  FeatureIntelligenceError,
  type BuildFeatureGraphInput,
  type FeatureChangeImpact,
  type FeatureFlow,
  type FeatureFlowStep,
  type FeatureFlowStepKind,
  type FeatureGraph,
  type FeatureNavigationResult,
  type FeatureRecord,
  type FeatureRelationship,
  type FeatureRelationshipKind,
} from "./types.js";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

const FEATURE_VOCABULARY = Object.freeze([
  { name: "Authentication", tokens: ["auth", "authentication", "login", "logout", "session", "token", "oauth", "password"] },
  { name: "Payments", tokens: ["payment", "payments", "billing", "checkout", "invoice", "subscription", "stripe"] },
  { name: "Notifications", tokens: ["notification", "notifications", "notify", "email", "sms", "webhook", "push"] },
  { name: "Search", tokens: ["search", "query", "filter", "lookup", "index"] },
  { name: "Profile Management", tokens: ["profile", "account", "preferences", "settings", "avatar"] },
] as const);

const GENERIC = new Set([
  "src", "lib", "app", "apps", "api", "route", "routes", "controller",
  "controllers", "service", "services", "handler", "handlers", "index", "main",
  "server", "module", "modules", "repository", "repositories", "db", "database",
]);

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter(Boolean);
}

function title(value: string): string {
  return value.split(/[-_\s]+/gu).filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function canonicalFeature(file: string, symbol?: SemanticSymbol): string | null {
  const tokens = new Set([...words(file), ...words(symbol?.qualifiedName ?? "")]);
  for (const feature of FEATURE_VOCABULARY) {
    if (feature.tokens.some((token) => tokens.has(token))) return feature.name;
  }
  const looksFeatureBearing =
    /(^|\/)(routes?|controllers?|api|services?|handlers?)(\/|$)/u.test(file) ||
    /(?:route|controller|handler|service)$/iu.test(symbol?.name ?? "");
  if (!looksFeatureBearing) return null;
  const candidate = words(file).reverse().find((token) =>
    !GENERIC.has(token) && !/^(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(token));
  return candidate ? title(candidate) : null;
}

export function deterministicFeatureId(input: {
  repositoryId: string;
  repositoryRevision: string;
  featureName: string;
}): string {
  return hash([
    "feature-v1", input.repositoryId, input.repositoryRevision,
    input.featureName.toLowerCase(),
  ]);
}

function stepKind(symbol: SemanticSymbol): FeatureFlowStepKind {
  const value = `${symbol.file} ${symbol.qualifiedName}`.toLowerCase();
  if (/(^|[\/\s])(routes?|api|http)([\/\s]|$)/u.test(value)) return "http_route";
  if (/controller|handler/u.test(value)) return "controller";
  if (/service|usecase|use_case/u.test(value)) return "service";
  if (/repositor(?:y|ies)|store|persistence/u.test(value)) return "repository";
  if (/database|(^|[\/\s])db([\/\s]|$)|sql/u.test(value)) return "database";
  return "symbol";
}

function semanticAdjacency(
  graph: BuildFeatureGraphInput["semanticGraph"],
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.relationships) {
    if (!["calls", "imports", "references"].includes(edge.kind)) continue;
    adjacency.set(edge.fromSymbolId, sortedUnique([
      ...(adjacency.get(edge.fromSymbolId) ?? []), edge.toSymbolId,
    ]));
  }
  return adjacency;
}

function flowFor(
  featureId: string,
  entry: SemanticSymbol,
  members: ReadonlySet<string>,
  symbols: ReadonlyMap<string, SemanticSymbol>,
  adjacency: ReadonlyMap<string, readonly string[]>,
  graphVersion: string,
  timestamp: string,
): FeatureFlow {
  const visited = new Set<string>();
  const ordered: SemanticSymbol[] = [];
  const visit = (symbolId: string, depth: number): void => {
    if (visited.has(symbolId) || !members.has(symbolId) || depth > 12) return;
    visited.add(symbolId);
    const symbol = symbols.get(symbolId);
    if (!symbol) return;
    ordered.push(symbol);
    for (const next of adjacency.get(symbolId) ?? []) visit(next, depth + 1);
  };
  visit(entry.symbolId, 0);
  if (ordered.length === 0) ordered.push(entry);
  const steps: FeatureFlowStep[] = ordered.map((symbol, position) => ({
    position,
    kind: stepKind(symbol),
    symbolId: symbol.symbolId,
    file: symbol.file,
    label: symbol.qualifiedName,
  }));
  const last = steps.at(-1)!;
  steps.push({
    position: steps.length,
    kind: "response",
    symbolId: null,
    file: last.file,
    label: "Response",
  });
  return {
    flowId: hash(["feature-flow-v1", featureId, entry.symbolId,
      steps.map((step) => [step.symbolId, step.kind])]),
    graphVersion,
    featureId,
    entryPoint: entry.symbolId,
    exitPoint: last.symbolId ?? entry.symbolId,
    steps,
    createdAt: timestamp,
  };
}

function endpointFor(file: string): string | null {
  const match = file.replaceAll("\\", "/").match(
    /(?:^|\/)(?:api|routes?)\/(.+?)(?:\/index)?\.[cm]?[jt]sx?$/u,
  );
  return match ? `/${match[1]!.replace(/\[(.+?)\]/gu, ":$1")}` : null;
}

function relation(
  input: BuildFeatureGraphInput,
  graphVersion: string,
  timestamp: string,
  fromFeatureId: string,
  kind: FeatureRelationshipKind,
  target: string,
  toFeatureId: string | null = null,
): FeatureRelationship {
  return {
    relationshipId: hash(["feature-relation-v1", input.repositoryId,
      input.repositoryRevision, fromFeatureId, toFeatureId, kind, target]),
    graphVersion,
    tenantId: input.tenantId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    fromFeatureId,
    toFeatureId,
    kind,
    target,
    createdAt: timestamp,
  };
}

export function buildFeatureGraph(input: BuildFeatureGraphInput): FeatureGraph {
  const intelligence = input.repositoryIntelligence;
  const semantic = input.semanticGraph;
  if (!input.tenantId || input.ownerId !== input.repositoryOwnerId ||
      input.ownerId !== semantic.ownerId ||
      input.repositoryId !== semantic.repositoryId ||
      input.repositoryId !== intelligence.repositoryId ||
      input.repositoryRevision !== semantic.repositoryRevision ||
      input.repositoryRevision !== intelligence.repositoryRevision ||
      semantic.lifecycle !== "published" || intelligence.status !== "published") {
    throw new FeatureIntelligenceError(
      "feature_repository_access_denied",
      "Published repository and semantic intelligence with matching ownership and revision are required.",
    );
  }
  const started = Date.now();
  const timestamp = input.indexedAt ?? new Date().toISOString();
  const semanticSymbols = new Map(semantic.symbols.map((symbol) =>
    [symbol.symbolId, symbol]));
  const adjacency = semanticAdjacency(semantic);
  const grouped = new Map<string, Set<string>>();
  const fileFeatures = new Map<string, Set<string>>();

  for (const symbol of semantic.symbols) {
    const name = canonicalFeature(symbol.file, symbol);
    if (!name) continue;
    grouped.set(name, new Set([...(grouped.get(name) ?? []), symbol.symbolId]));
    fileFeatures.set(symbol.file, new Set([
      ...(fileFeatures.get(symbol.file) ?? []), name,
    ]));
  }
  for (const subsystem of intelligence.subsystems) {
    const name = canonicalFeature(subsystem.rootPath);
    if (!name) continue;
    const ids = semantic.symbols.filter((symbol) =>
      subsystem.files.includes(symbol.file)).map((symbol) => symbol.symbolId);
    if (ids.length > 0) grouped.set(
      name, new Set([...(grouped.get(name) ?? []), ...ids]),
    );
  }

  const graphVersion = hash([
    FEATURE_INTELLIGENCE_SCHEMA_VERSION,
    input.repositoryId,
    input.repositoryRevision,
    intelligence.intelligenceVersion,
    semantic.graphVersion,
    [...grouped].map(([name, ids]) => [name, [...ids].sort()]).sort(),
  ]);
  const changed = new Set(input.changedFiles ?? []);
  let incrementalRebuildCount = 0;
  const features: FeatureRecord[] = [];
  const flows: FeatureFlow[] = [];

  for (const [name, memberIds] of [...grouped].sort((a, b) =>
    a[0].localeCompare(b[0]))) {
    const members = [...memberIds].map((id) => semanticSymbols.get(id))
      .filter((value): value is SemanticSymbol => Boolean(value))
      .sort((a, b) => a.file.localeCompare(b.file) ||
        a.line - b.line || a.symbolId.localeCompare(b.symbolId));
    if (members.length === 0) continue;
    const featureId = deterministicFeatureId({
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      featureName: name,
    });
    const files = sortedUnique(members.map((item) => item.file));
    const owningModules = sortedUnique([
      ...intelligence.subsystems.filter((subsystem) =>
        subsystem.files.some((file) => files.includes(file)))
        .map((subsystem) => subsystem.subsystemId),
      ...files.map((file) => file.split("/").slice(0, -1).join("/") || "."),
    ]);
    const previousFeature = input.previousGraph?.features.find((feature) =>
      feature.featureId === featureId);
    const impacted = files.some((file) => changed.has(file)) ||
      Boolean(previousFeature?.files.some((file) => changed.has(file)));
    if (previousFeature && !impacted &&
        input.previousGraph?.graphVersion === graphVersion) {
      features.push(previousFeature);
      flows.push(...input.previousGraph.flows.filter((flow) =>
        flow.featureId === featureId));
      continue;
    }
    const entries = members.filter((symbol) => {
      const kind = stepKind(symbol);
      const incoming = semantic.relationships.some((edge) =>
        edge.toSymbolId === symbol.symbolId && edge.kind === "calls" &&
        memberIds.has(edge.fromSymbolId));
      return kind === "http_route" || kind === "controller" ||
        (!incoming && symbol.visibility === "public");
    });
    const entryPoints = sortedUnique(
      (entries.length > 0 ? entries : [members[0]!]).map((item) => item.symbolId),
    );
    const featureFlows = entryPoints.map((entryId) =>
      flowFor(featureId, semanticSymbols.get(entryId)!, memberIds,
        semanticSymbols, adjacency, graphVersion, timestamp));
    flows.push(...featureFlows);
    const exitPoints = sortedUnique(featureFlows.map((flow) => flow.exitPoint));
    const tokenEvidence = FEATURE_VOCABULARY.find((item) => item.name === name)
      ?.tokens.filter((token) => files.some((file) => words(file).includes(token)))
      .length ?? 0;
    const confidence = Math.min(1, Number(
      (0.45 + Math.min(0.25, tokenEvidence * 0.08) +
        Math.min(0.2, entryPoints.length * 0.05) +
        Math.min(0.1, members.length * 0.01)).toFixed(3),
    ));
    if (input.previousGraph && impacted) {
      incrementalRebuildCount += 1;
    }
    features.push({
      featureId,
      graphVersion,
      tenantId: input.tenantId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.repositoryRevision,
      name,
      description: `${name} spans ${files.length} files, ${members.length} symbols, and ${entryPoints.length} entry points.`,
      confidence,
      primaryEntryPoint: entryPoints[0]!,
      primaryExitPoint: exitPoints[0]!,
      entryPoints,
      exitPoints,
      owningModules,
      files,
      symbolIds: members.map((item) => item.symbolId).sort(),
      lifecycle: entryPoints.length > 0 && exitPoints.length > 0
        ? "active" : "partial",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const featureBySymbol = new Map<string, string>();
  for (const feature of features) {
    for (const symbolId of feature.symbolIds) {
      if (!featureBySymbol.has(symbolId)) featureBySymbol.set(symbolId, feature.featureId);
    }
  }
  const relationships: FeatureRelationship[] = [];
  for (const feature of features) {
    for (const module of feature.owningModules) relationships.push(
      relation(input, graphVersion, timestamp, feature.featureId,
        "owns_module", module));
    for (const file of feature.files) {
      const endpoint = endpointFor(file);
      if (endpoint) relationships.push(
        relation(input, graphVersion, timestamp, feature.featureId,
          "exposes_endpoint", endpoint));
    }
  }
  for (const edge of semantic.relationships) {
    if (!["calls", "imports", "references"].includes(edge.kind)) continue;
    const from = featureBySymbol.get(edge.fromSymbolId);
    const to = featureBySymbol.get(edge.toSymbolId);
    if (!from || !to || from === to) continue;
    const kind: FeatureRelationshipKind = edge.kind === "calls"
      ? "calls_feature"
      : edge.kind === "imports" ? "depends_on_feature" : "shares_components";
    relationships.push(relation(
      input, graphVersion, timestamp, from, kind, edge.relationshipId, to,
    ));
  }
  const uniqueRelationships = [...new Map(relationships.map((item) => [
    item.relationshipId, item,
  ])).values()].sort((a, b) => a.relationshipId.localeCompare(b.relationshipId));
  features.sort((a, b) => a.featureId.localeCompare(b.featureId));
  flows.sort((a, b) => a.flowId.localeCompare(b.flowId));
  const dependencyEdges = uniqueRelationships.filter((item) =>
    item.toFeatureId !== null).length;
  return {
    graphVersion,
    schemaVersion: FEATURE_INTELLIGENCE_SCHEMA_VERSION,
    persistenceVersion: 1,
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    repositoryIntelligenceVersion: intelligence.intelligenceVersion,
    semanticGraphVersion: semantic.graphVersion,
    lifecycle: "published",
    features,
    relationships: uniqueRelationships,
    flows,
    diagnostics: features.length === 0 ? [{
      code: "feature_discovery_empty",
      message: "No deterministic feature evidence was discovered.",
      severity: "info",
    }] : [],
    metrics: {
      featuresDiscovered: features.length,
      averageFeatureSize: features.length === 0 ? 0 :
        Number((features.reduce((sum, feature) =>
          sum + feature.symbolIds.length, 0) / features.length).toFixed(3)),
      dependencyDensity: features.length < 2 ? 0 :
        Number((dependencyEdges / (features.length * (features.length - 1)))
          .toFixed(3)),
      rebuildDurationMs: input.indexedAt ? 0 : Math.max(0, Date.now() - started),
      incrementalRebuildCount,
      recoveryCount: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

export class FeatureNavigator {
  constructor(private readonly graph: FeatureGraph) {}

  byName(name: string): FeatureNavigationResult {
    const feature = this.graph.features.find((item) =>
      item.name.toLowerCase() === name.toLowerCase()) ?? null;
    return this.result(feature);
  }

  private result(feature: FeatureRecord | null): FeatureNavigationResult {
    if (!feature) return { feature: null, features: [], relationships: [], flows: [] };
    return {
      feature,
      features: [feature],
      relationships: this.graph.relationships.filter((item) =>
        item.fromFeatureId === feature.featureId ||
        item.toFeatureId === feature.featureId),
      flows: this.graph.flows.filter((item) => item.featureId === feature.featureId),
    };
  }

  entryPoints(name: string) { return this.byName(name).feature?.entryPoints ?? []; }
  exitPoints(name: string) { return this.byName(name).feature?.exitPoints ?? []; }
  files(name: string) { return this.byName(name).feature?.files ?? []; }
  symbols(name: string) { return this.byName(name).feature?.symbolIds ?? []; }

  dependencies(name: string) {
    return this.related(name, ["depends_on_feature", "calls_feature"], "downstream");
  }

  downstream(name: string) {
    return this.related(name, [
      "depends_on_feature", "calls_feature", "shares_components",
    ], "downstream");
  }

  upstream(name: string) {
    return this.related(name, [
      "depends_on_feature", "calls_feature", "shares_components",
    ], "upstream");
  }

  private related(
    name: string,
    kinds: readonly FeatureRelationshipKind[],
    direction: "upstream" | "downstream",
  ): FeatureRecord[] {
    const feature = this.byName(name).feature;
    if (!feature) return [];
    const ids = new Set(this.graph.relationships.filter((item) =>
      kinds.includes(item.kind) &&
      (direction === "downstream"
        ? item.fromFeatureId === feature.featureId
        : item.toFeatureId === feature.featureId))
      .map((item) => direction === "downstream"
        ? item.toFeatureId : item.fromFeatureId)
      .filter((id): id is string => Boolean(id)));
    return this.graph.features.filter((item) => ids.has(item.featureId));
  }

  changeImpact(query: {
    file?: string;
    symbolId?: string;
    module?: string;
  }): FeatureChangeImpact {
    const affected = this.graph.features.filter((feature) =>
      (query.file ? feature.files.includes(query.file) : false) ||
      (query.symbolId ? feature.symbolIds.includes(query.symbolId) : false) ||
      (query.module ? feature.owningModules.includes(query.module) : false));
    const affectedIds = new Set(affected.map((item) => item.featureId));
    const downstreamIds = new Set<string>();
    const chain: FeatureRelationship[] = [];
    const queue = [...affectedIds];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of this.graph.relationships.filter((item) =>
        item.fromFeatureId === current && item.toFeatureId &&
        ["depends_on_feature", "calls_feature", "shares_components"].includes(item.kind))) {
        chain.push(edge);
        if (!affectedIds.has(edge.toFeatureId!) &&
            !downstreamIds.has(edge.toFeatureId!)) {
          downstreamIds.add(edge.toFeatureId!);
          queue.push(edge.toFeatureId!);
        }
      }
    }
    const total = affected.length + downstreamIds.size;
    const level = total >= 4 ? "high" : total >= 2 ? "medium" : "low";
    return {
      query,
      affectedFeatures: affected,
      dependencyChain: [...new Map(chain.map((item) =>
        [item.relationshipId, item])).values()],
      impactedEntryPoints: sortedUnique(affected.flatMap((item) => item.entryPoints)),
      downstreamRisk: {
        level,
        impactedFeatureCount: affected.length,
        downstreamFeatureCount: downstreamIds.size,
        reason: `${affected.length} directly affected and ${downstreamIds.size} downstream features.`,
      },
    };
  }
}
