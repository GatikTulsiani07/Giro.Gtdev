import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  AuxiliaryEvolution, EntityEvolution, EvolutionEvidence,
  EvolutionTimelineEntry, EvolutionTimelineKind, EvolutionTrend,
  FeatureEvolution, RepositoryEvolutionSources, RevisionComparison,
  SemanticEvolution,
} from "./types.js";

const sorted = (values: readonly string[]) => [...new Set(values)].sort();
const bounded = (value: number) =>
  Number(Math.max(0, Math.min(1, value)).toFixed(3));
const object = (value: unknown): Readonly<Record<string, unknown>> =>
  value as Readonly<Record<string, unknown>>;

function evidence(
  sourceEngine: string,
  sourceVersion: string,
  reference: string,
  details: Readonly<Record<string, unknown>>,
): EvolutionEvidence {
  return {
    evidenceId: stableId("evolution_evidence", {
      sourceEngine, sourceVersion, reference, details,
    }),
    sourceEngine, sourceVersion, reference, details,
  };
}

function entity(
  category: string,
  name: string,
  change: EntityEvolution["change"],
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
  evidenceItems: readonly EvolutionEvidence[],
): EntityEvolution {
  return {
    entityId: stableId("evolution_entity", { category, name }),
    name, change, before, after,
    evidence: [...evidenceItems].sort((a, b) =>
      a.sourceEngine.localeCompare(b.sourceEngine) ||
      a.reference.localeCompare(b.reference)),
  };
}

function canonicalCycle(value: readonly string[]) {
  if (value.length === 0) return "";
  const rotations = value.map((_, index) =>
    [...value.slice(index), ...value.slice(0, index)].join("->"));
  return rotations.sort()[0]!;
}

function compareFeatures(sources: RepositoryEvolutionSources): FeatureEvolution {
  const base = new Map(sources.base.featureGraph.features.map((item) =>
    [item.name.toLowerCase(), item]));
  const target = new Map(sources.target.featureGraph.features.map((item) =>
    [item.name.toLowerCase(), item]));
  const relationshipKeys = (
    graph: RepositoryEvolutionSources["base"]["featureGraph"],
    featureId: string,
  ) => sorted(graph.relationships.filter((item) =>
    item.fromFeatureId === featureId || item.toFeatureId === featureId)
    .map((item) => `${item.kind}:${item.target}`));
  const snapshot = (
    graph: RepositoryEvolutionSources["base"]["featureGraph"],
    item: (typeof graph.features)[number],
  ) => object({
    featureId: item.featureId, name: item.name,
    files: sorted(item.files), symbols: sorted(item.symbolIds),
    owningModules: sorted(item.owningModules),
    dependencies: relationshipKeys(graph, item.featureId),
    flowSteps: graph.flows.filter((flow) => flow.featureId === item.featureId)
      .reduce((sum, flow) => sum + flow.steps.length, 0),
    size: item.files.length + item.symbolIds.length,
    complexity: relationshipKeys(graph, item.featureId).length +
      graph.flows.filter((flow) => flow.featureId === item.featureId)
        .reduce((sum, flow) => sum + flow.steps.length, 0),
    stability: item.lifecycle === "active" ? 1 :
      item.lifecycle === "partial" ? 0.5 : 0,
    lifecycle: item.lifecycle,
  });
  const result: { added: EntityEvolution[]; removed: EntityEvolution[];
    modified: EntityEvolution[] } = { added: [], removed: [], modified: [] };
  for (const key of sorted([...base.keys(), ...target.keys()])) {
    const beforeFeature = base.get(key);
    const afterFeature = target.get(key);
    const before = beforeFeature
      ? snapshot(sources.base.featureGraph, beforeFeature) : null;
    const after = afterFeature
      ? snapshot(sources.target.featureGraph, afterFeature) : null;
    if (!beforeFeature && afterFeature) {
      result.added.push(entity("feature", afterFeature.name, "added", null, after,
        [evidence("Feature Intelligence",
          sources.target.featureGraph.graphVersion, afterFeature.featureId,
          { revision: sources.target.featureGraph.repositoryRevision })]));
    } else if (beforeFeature && !afterFeature) {
      result.removed.push(entity("feature", beforeFeature.name, "removed",
        before, null, [evidence("Feature Intelligence",
          sources.base.featureGraph.graphVersion, beforeFeature.featureId,
          { revision: sources.base.featureGraph.repositoryRevision })]));
    } else if (beforeFeature && afterFeature &&
      stableHash(before) !== stableHash(after)) {
      result.modified.push(entity("feature", afterFeature.name, "modified",
        before, after, [
          evidence("Feature Intelligence", sources.base.featureGraph.graphVersion,
            beforeFeature.featureId, { side: "base" }),
          evidence("Feature Intelligence", sources.target.featureGraph.graphVersion,
            afterFeature.featureId, { side: "target" }),
        ]));
    }
  }
  return result;
}

function compareArchitecture(sources: RepositoryEvolutionSources) {
  const baseIntel = sources.base.repositoryIntelligence;
  const targetIntel = sources.target.repositoryIntelligence;
  const base = new Map(baseIntel.subsystems.map((item) =>
    [item.rootPath || item.name, item]));
  const target = new Map(targetIntel.subsystems.map((item) =>
    [item.rootPath || item.name, item]));
  const snapshot = (item: (typeof baseIntel.subsystems)[number]) => object({
    subsystemId: item.subsystemId, rootPath: item.rootPath,
    files: sorted(item.files), dependencies: sorted(item.dependencies),
    incomingDependencies: item.metrics.incomingDependencies,
    outgoingDependencies: item.metrics.outgoingDependencies,
    coupling: item.metrics.incomingDependencies +
      item.metrics.outgoingDependencies,
  });
  const newModules: EntityEvolution[] = [];
  const removedModules: EntityEvolution[] = [];
  const couplingChanges: EntityEvolution[] = [];
  for (const key of sorted([...base.keys(), ...target.keys()])) {
    const beforeModule = base.get(key);
    const afterModule = target.get(key);
    const before = beforeModule ? snapshot(beforeModule) : null;
    const after = afterModule ? snapshot(afterModule) : null;
    if (!beforeModule && afterModule) newModules.push(entity(
      "module", key, "added", null, after,
      [evidence("Repository Intelligence", targetIntel.intelligenceVersion,
        afterModule.subsystemId, { rootPath: afterModule.rootPath })]));
    else if (beforeModule && !afterModule) removedModules.push(entity(
      "module", key, "removed", before, null,
      [evidence("Repository Intelligence", baseIntel.intelligenceVersion,
        beforeModule.subsystemId, { rootPath: beforeModule.rootPath })]));
    else if (beforeModule && afterModule &&
      (beforeModule.metrics.incomingDependencies !==
        afterModule.metrics.incomingDependencies ||
       beforeModule.metrics.outgoingDependencies !==
        afterModule.metrics.outgoingDependencies)) {
      couplingChanges.push(entity("module-coupling", key, "modified",
        before, after, [
          evidence("Repository Intelligence", baseIntel.intelligenceVersion,
            beforeModule.subsystemId, { side: "base" }),
          evidence("Repository Intelligence", targetIntel.intelligenceVersion,
            afterModule.subsystemId, { side: "target" }),
        ]));
    }
  }
  const cycleMap = (cycles: readonly string[][]) =>
    new Map(cycles.map((cycle) => [canonicalCycle(cycle), [...cycle]]));
  const baseCycles = cycleMap(baseIntel.codeOrganization.cyclicDependencies);
  const targetCycles = cycleMap(targetIntel.codeOrganization.cyclicDependencies);
  const hotspotMap = (items: readonly { path: string; value: number }[]) =>
    new Map(items.map((item) => [item.path, item]));
  const baseHotspots = hotspotMap(baseIntel.architecture.hotspots);
  const targetHotspots = hotspotMap(targetIntel.architecture.hotspots);
  const hotspotChanges: EntityEvolution[] = [];
  for (const path of sorted([...baseHotspots.keys(), ...targetHotspots.keys()])) {
    const beforeHotspot = baseHotspots.get(path);
    const afterHotspot = targetHotspots.get(path);
    if (beforeHotspot?.value === afterHotspot?.value) continue;
    const change = !beforeHotspot ? "added" : !afterHotspot ? "removed" : "modified";
    hotspotChanges.push(entity("hotspot", path, change,
      beforeHotspot ? object(beforeHotspot) : null,
      afterHotspot ? object(afterHotspot) : null, [
        evidence("Repository Intelligence",
          afterHotspot ? targetIntel.intelligenceVersion :
            baseIntel.intelligenceVersion,
          path, { before: beforeHotspot?.value ?? null,
            after: afterHotspot?.value ?? null }),
      ]));
  }
  return {
    newModules, removedModules, couplingChanges,
    dependencyGrowth: targetIntel.metrics.dependencyEdgesAnalyzed -
      baseIntel.metrics.dependencyEdgesAnalyzed,
    introducedCycles: sorted([...targetCycles.keys()].filter((key) =>
      !baseCycles.has(key))).map((key) => targetCycles.get(key)!),
    resolvedCycles: sorted([...baseCycles.keys()].filter((key) =>
      !targetCycles.has(key))).map((key) => baseCycles.get(key)!),
    hotspotChanges,
  };
}

function graphNodeKey(
  node: RepositoryEvolutionSources["base"]["repositoryGraph"]["nodes"][number],
) {
  return `${node.kind}:${node.qualifiedName}:${node.file}`;
}

function compareDependencies(sources: RepositoryEvolutionSources) {
  const descriptors = (side: "base" | "target") => {
    const graph = sources[side].repositoryGraph;
    const nodes = new Map(graph.nodes.map((item) => [item.nodeId, item]));
    return new Map(graph.edges.map((edge) => {
      const from = nodes.get(edge.fromNodeId);
      const to = nodes.get(edge.toNodeId);
      const key = `${edge.kind}:${from ? graphNodeKey(from) : edge.fromNodeId}` +
        `->${to ? graphNodeKey(to) : edge.toNodeId}`;
      return [key, { edge, from, to }] as const;
    }));
  };
  const base = descriptors("base");
  const target = descriptors("target");
  const build = (
    key: string, change: "added" | "removed",
    item: NonNullable<ReturnType<typeof base.get>>,
    version: string,
  ) => entity("dependency", key, change,
    change === "removed" ? object({ kind: item.edge.kind,
      from: item.from ? graphNodeKey(item.from) : item.edge.fromNodeId,
      to: item.to ? graphNodeKey(item.to) : item.edge.toNodeId }) : null,
    change === "added" ? object({ kind: item.edge.kind,
      from: item.from ? graphNodeKey(item.from) : item.edge.fromNodeId,
      to: item.to ? graphNodeKey(item.to) : item.edge.toNodeId }) : null,
    [evidence("Repository Graph", version, item.edge.edgeId,
      { dependency: key })]);
  return {
    added: sorted([...target.keys()].filter((key) => !base.has(key)))
      .map((key) => build(key, "added", target.get(key)!,
        sources.target.repositoryGraph.graphVersion)),
    removed: sorted([...base.keys()].filter((key) => !target.has(key)))
      .map((key) => build(key, "removed", base.get(key)!,
        sources.base.repositoryGraph.graphVersion)),
  };
}

function compareSemantic(sources: RepositoryEvolutionSources): SemanticEvolution {
  const symbolKey = (
    item: RepositoryEvolutionSources["base"]["semanticGraph"]["symbols"][number],
  ) => `${item.kind}:${item.qualifiedName}`;
  const base = new Map(sources.base.semanticGraph.symbols.map((item) =>
    [symbolKey(item), item]));
  const target = new Map(sources.target.semanticGraph.symbols.map((item) =>
    [symbolKey(item), item]));
  const snapshot = (item: NonNullable<ReturnType<typeof base.get>>) => object({
    symbolId: item.symbolId, kind: item.kind, name: item.name,
    qualifiedName: item.qualifiedName, file: item.file,
    signature: item.signature, visibility: item.visibility,
  });
  const symbolAdditions: EntityEvolution[] = [];
  const symbolRemovals: EntityEvolution[] = [];
  const interfaceChanges: EntityEvolution[] = [];
  const implementationChanges: EntityEvolution[] = [];
  const apiEvolution: EntityEvolution[] = [];
  const publicLike = (item: NonNullable<ReturnType<typeof base.get>>) =>
    item.visibility === "public";
  for (const key of sorted([...base.keys(), ...target.keys()])) {
    const beforeSymbol = base.get(key);
    const afterSymbol = target.get(key);
    const before = beforeSymbol ? snapshot(beforeSymbol) : null;
    const after = afterSymbol ? snapshot(afterSymbol) : null;
    const makeEvidence = () => [
      ...(beforeSymbol ? [evidence("Semantic Code Intelligence",
        sources.base.semanticGraph.graphVersion, beforeSymbol.symbolId,
        { side: "base", file: beforeSymbol.file })] : []),
      ...(afterSymbol ? [evidence("Semantic Code Intelligence",
        sources.target.semanticGraph.graphVersion, afterSymbol.symbolId,
        { side: "target", file: afterSymbol.file })] : []),
    ];
    if (!beforeSymbol && afterSymbol) {
      const change = entity("symbol", key, "added", null, after, makeEvidence());
      symbolAdditions.push(change);
      if (publicLike(afterSymbol)) apiEvolution.push(entity(
        "api", key, "added", null, after, makeEvidence()));
    } else if (beforeSymbol && !afterSymbol) {
      const change = entity("symbol", key, "removed", before, null, makeEvidence());
      symbolRemovals.push(change);
      if (publicLike(beforeSymbol)) apiEvolution.push(entity(
        "api", key, "removed", before, null, makeEvidence()));
    } else if (beforeSymbol && afterSymbol) {
      const signatureChanged = beforeSymbol.signature !== afterSymbol.signature ||
        beforeSymbol.visibility !== afterSymbol.visibility;
      const baseFile = sources.base.semanticGraph.fileAnalyses.find((item) =>
        item.file === beforeSymbol.file);
      const targetFile = sources.target.semanticGraph.fileAnalyses.find((item) =>
        item.file === afterSymbol.file);
      if (signatureChanged) {
        interfaceChanges.push(entity("interface", key, "modified",
          before, after, makeEvidence()));
        if (publicLike(beforeSymbol) || publicLike(afterSymbol)) {
          apiEvolution.push(entity("api", key, "modified",
            before, after, makeEvidence()));
        }
      } else if (baseFile?.contentHash !== targetFile?.contentHash ||
        beforeSymbol.file !== afterSymbol.file) {
        implementationChanges.push(entity("implementation", key, "modified",
          before, after, makeEvidence()));
      }
    }
  }
  const relationships = (side: "base" | "target") => {
    const graph = sources[side].semanticGraph;
    const symbols = new Map(graph.symbols.map((item) =>
      [item.symbolId, symbolKey(item)]));
    return new Map(graph.relationships.filter((item) =>
      ["extends", "implements", "overrides"].includes(item.kind))
      .map((item) => {
        const key = `${item.kind}:${symbols.get(item.fromSymbolId)}` +
          `->${symbols.get(item.toSymbolId)}`;
        return [key, item] as const;
      }));
  };
  const baseRelationships = relationships("base");
  const targetRelationships = relationships("target");
  const inheritanceChanges: EntityEvolution[] = [
    ...sorted([...targetRelationships.keys()].filter((key) =>
      !baseRelationships.has(key))).map((key) => entity(
        "inheritance", key, "added", null, object({ relationship: key }),
        [evidence("Semantic Code Intelligence",
          sources.target.semanticGraph.graphVersion,
          targetRelationships.get(key)!.relationshipId, { relationship: key })])),
    ...sorted([...baseRelationships.keys()].filter((key) =>
      !targetRelationships.has(key))).map((key) => entity(
        "inheritance", key, "removed", object({ relationship: key }), null,
        [evidence("Semantic Code Intelligence",
          sources.base.semanticGraph.graphVersion,
          baseRelationships.get(key)!.relationshipId, { relationship: key })])),
  ];
  return {
    symbolAdditions, symbolRemovals, interfaceChanges, inheritanceChanges,
    implementationChanges, apiEvolution,
  };
}

function compareAuxiliary(
  category: "workflow" | "knowledge",
  baseItems: readonly { key: string; fingerprint: string; version: string;
    snapshot: Readonly<Record<string, unknown>> }[],
  targetItems: readonly { key: string; fingerprint: string; version: string;
    snapshot: Readonly<Record<string, unknown>> }[],
): AuxiliaryEvolution {
  const base = new Map(baseItems.map((item) => [item.key, item]));
  const target = new Map(targetItems.map((item) => [item.key, item]));
  const result: { added: EntityEvolution[]; removed: EntityEvolution[];
    modified: EntityEvolution[] } = { added: [], removed: [], modified: [] };
  for (const key of sorted([...base.keys(), ...target.keys()])) {
    const before = base.get(key);
    const after = target.get(key);
    if (!before && after) result.added.push(entity(
      category, key, "added", null, after.snapshot,
      [evidence(category === "workflow" ? "Workflow Orchestrator" :
        "Repository Knowledge", after.version, key, { side: "target" })]));
    else if (before && !after) result.removed.push(entity(
      category, key, "removed", before.snapshot, null,
      [evidence(category === "workflow" ? "Workflow Orchestrator" :
        "Repository Knowledge", before.version, key, { side: "base" })]));
    else if (before && after && before.fingerprint !== after.fingerprint) {
      result.modified.push(entity(category, key, "modified",
        before.snapshot, after.snapshot, [
          evidence(category === "workflow" ? "Workflow Orchestrator" :
            "Repository Knowledge", before.version, key, { side: "base" }),
          evidence(category === "workflow" ? "Workflow Orchestrator" :
            "Repository Knowledge", after.version, key, { side: "target" }),
        ]));
    }
  }
  return result;
}

export function compareRepositoryEvolution(
  sources: RepositoryEvolutionSources,
): RevisionComparison {
  const workflows = (side: "base" | "target") =>
    sources[side].workflows.map((item) => ({
      key: item.workflowId, version: String(item.workflowVersion),
      fingerprint: stableHash({
        lifecycle: item.lifecycle, stage: item.currentStage,
        checkpoints: item.checkpoints.map((checkpoint) => ({
          stage: checkpoint.stage, status: checkpoint.result.status,
          resultHash: checkpoint.result.outputHash,
        })),
      }),
      snapshot: object({
        workflowId: item.workflowId, lifecycle: item.lifecycle,
        stage: item.currentStage, checkpointCount: item.checkpoints.length,
        failureCount: item.failureCount, resumeCount: item.resumeCount,
      }),
    }));
  const knowledge = (side: "base" | "target") =>
    sources[side].knowledge.map((item) => ({
      key: `${item.namespace}:${item.subject}`,
      version: String(item.version), fingerprint: item.contentHash,
      snapshot: object({
        knowledgeId: item.knowledgeId, namespace: item.namespace,
        subject: item.subject, contentHash: item.contentHash,
        confidence: item.confidence,
      }),
    }));
  return {
    features: compareFeatures(sources),
    architecture: compareArchitecture(sources),
    dependencies: compareDependencies(sources),
    semantic: compareSemantic(sources),
    workflows: compareAuxiliary(
      "workflow", workflows("base"), workflows("target")),
    knowledge: compareAuxiliary(
      "knowledge", knowledge("base"), knowledge("target")),
  };
}

function allChanges(comparison: RevisionComparison): Array<{
  kind: EvolutionTimelineKind; item: EntityEvolution;
}> {
  return [
    ...comparison.features.added.map((item) => ({ kind: "feature" as const, item })),
    ...comparison.features.removed.map((item) => ({ kind: "feature" as const, item })),
    ...comparison.features.modified.map((item) => ({ kind: "feature" as const, item })),
    ...comparison.architecture.newModules.map((item) => ({ kind: "module" as const, item })),
    ...comparison.architecture.removedModules.map((item) => ({ kind: "module" as const, item })),
    ...comparison.architecture.couplingChanges.map((item) => ({ kind: "module" as const, item })),
    ...comparison.architecture.hotspotChanges.map((item) => ({ kind: "architecture" as const, item })),
    ...comparison.dependencies.added.map((item) => ({ kind: "dependency" as const, item })),
    ...comparison.dependencies.removed.map((item) => ({ kind: "dependency" as const, item })),
    ...comparison.semantic.symbolAdditions.map((item) => ({ kind: "symbol" as const, item })),
    ...comparison.semantic.symbolRemovals.map((item) => ({ kind: "symbol" as const, item })),
    ...comparison.semantic.interfaceChanges.map((item) => ({ kind: "symbol" as const, item })),
    ...comparison.semantic.inheritanceChanges.map((item) => ({ kind: "symbol" as const, item })),
    ...comparison.semantic.implementationChanges.map((item) => ({ kind: "symbol" as const, item })),
    ...comparison.semantic.apiEvolution.map((item) => ({ kind: "api" as const, item })),
  ];
}

export function buildEvolutionTimelines(
  evolutionId: string,
  baseRevision: string,
  targetRevision: string,
  comparisonTimestamp: string,
  comparison: RevisionComparison,
): EvolutionTimelineEntry[] {
  const values = allChanges(comparison).map(({ kind, item }) => ({
    timelineId: stableId("evolution_timeline", {
      evolutionId, kind, entityId: item.entityId, change: item.change,
    }),
    evolutionId, kind, entityId: item.entityId, entityName: item.name,
    change: item.change, baseRevision, targetRevision,
    evidence: item.evidence,
    details: object({ before: item.before, after: item.after }),
    occurredAt: comparisonTimestamp,
  }));
  const fileEvents = allChanges(comparison).flatMap(({ item }) => {
    const files = sorted([
      ...((item.before?.files as readonly string[] | undefined) ?? []),
      ...((item.after?.files as readonly string[] | undefined) ?? []),
      ...item.evidence.map((entry) => String(entry.details.file ?? ""))
        .filter(Boolean),
    ]);
    return files.map((file) => ({
      timelineId: stableId("evolution_timeline", {
        evolutionId, kind: "file", entityId: file,
        sourceEntityId: item.entityId, change: item.change,
      }),
      evolutionId, kind: "file" as const,
      entityId: file, entityName: file, change: item.change,
      baseRevision, targetRevision, evidence: item.evidence,
      details: object({ sourceEntityId: item.entityId, sourceName: item.name }),
      occurredAt: comparisonTimestamp,
    }));
  });
  const unique = new Map([...values, ...fileEvents].map((item) =>
    [item.timelineId, item]));
  return [...unique.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.entityName.localeCompare(b.entityName) ||
    a.timelineId.localeCompare(b.timelineId));
}

export function generateEvolutionTrends(
  evolutionId: string,
  comparison: RevisionComparison,
  sources: RepositoryEvolutionSources,
): EvolutionTrend[] {
  const candidates: Array<Omit<EvolutionTrend, "trendId" | "evolutionId">> = [];
  const couplingDelta = comparison.architecture.couplingChanges.reduce(
    (sum, item) => sum +
      Number(item.after?.coupling ?? 0) - Number(item.before?.coupling ?? 0), 0);
  if (couplingDelta > 0) candidates.push({
    type: "increasing coupling", direction: "increasing",
    magnitude: bounded(couplingDelta / 20),
    confidence: 0.95,
    summary: `Published module coupling increased by ${couplingDelta}.`,
    evidence: comparison.architecture.couplingChanges.flatMap((item) =>
      item.evidence),
  });
  const featureDelta = comparison.features.modified.reduce((sum, item) =>
    sum + Number(item.after?.size ?? 0) - Number(item.before?.size ?? 0), 0) +
    comparison.features.added.reduce((sum, item) =>
      sum + Number(item.after?.size ?? 0), 0);
  if (featureDelta > 0) candidates.push({
    type: "expanding features", direction: "increasing",
    magnitude: bounded(featureDelta / 50), confidence: 0.9,
    summary: `Published feature size increased by ${featureDelta} units.`,
    evidence: [...comparison.features.added,
      ...comparison.features.modified].flatMap((item) => item.evidence),
  });
  const moduleDelta = comparison.architecture.newModules.reduce((sum, item) =>
    sum + ((item.after?.files as readonly unknown[] | undefined)?.length ?? 0), 0) -
    comparison.architecture.removedModules.reduce((sum, item) =>
      sum + ((item.before?.files as readonly unknown[] | undefined)?.length ?? 0), 0) +
    comparison.architecture.couplingChanges.reduce((sum, item) =>
      sum +
      ((item.after?.files as readonly unknown[] | undefined)?.length ?? 0) -
      ((item.before?.files as readonly unknown[] | undefined)?.length ?? 0), 0);
  if (moduleDelta < 0) candidates.push({
    type: "shrinking modules", direction: "decreasing",
    magnitude: bounded(Math.abs(moduleDelta) / 30), confidence: 0.9,
    summary: `Published module footprint decreased by ${Math.abs(moduleDelta)} files.`,
    evidence: comparison.architecture.removedModules.flatMap((item) =>
      item.evidence),
  });
  if (comparison.semantic.apiEvolution.length > 0) candidates.push({
    type: "unstable APIs", direction: "unstable",
    magnitude: bounded(comparison.semantic.apiEvolution.length / 20),
    confidence: 0.96,
    summary: `${comparison.semantic.apiEvolution.length} published API changes were detected.`,
    evidence: comparison.semantic.apiEvolution.flatMap((item) => item.evidence),
  });
  const dependencyMagnitude = Math.max(0,
    comparison.architecture.dependencyGrowth) +
    comparison.architecture.introducedCycles.length +
    comparison.dependencies.added.length;
  if (dependencyMagnitude > 0) candidates.push({
    type: "growing dependency chains", direction: "increasing",
    magnitude: bounded(dependencyMagnitude / 30), confidence: 0.94,
    summary: `Dependency growth produced ${dependencyMagnitude} deterministic change signals.`,
    evidence: comparison.dependencies.added.length > 0
      ? comparison.dependencies.added.flatMap((item) => item.evidence)
      : [evidence("Repository Intelligence",
        sources.target.repositoryIntelligence.intelligenceVersion,
        sources.target.repositoryIntelligence.repositoryId, {
          dependencyGrowth: comparison.architecture.dependencyGrowth,
          introducedCycles: comparison.architecture.introducedCycles,
        })],
  });
  return candidates.map((item) => ({
    ...item, evolutionId,
    trendId: stableId("evolution_trend", {
      evolutionId, type: item.type, direction: item.direction,
    }),
  })).sort((a, b) => b.magnitude - a.magnitude ||
    a.type.localeCompare(b.type));
}
