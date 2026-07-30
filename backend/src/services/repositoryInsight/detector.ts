import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  InsightEvidence, InsightEvidenceKind, InsightScore, InsightSeverity,
  RepositoryInsight, RepositoryInsightSources, RepositoryInsightType,
} from "./types.js";

interface Draft {
  type: RepositoryInsightType;
  subject: string;
  title: string;
  summary: string;
  severity: InsightSeverity;
  confidence: number;
  evidence: InsightEvidence[];
  features?: string[];
  symbols?: string[];
  files?: string[];
  signals: Partial<Omit<InsightScore, "total">>;
}

const unique = (values: readonly string[]) => [...new Set(values)].sort();
const bounded = (value: number) => Number(Math.max(0, Math.min(1, value)).toFixed(3));
const severityWeight: Record<InsightSeverity, number> = {
  info: 0.1, low: 0.25, medium: 0.5, high: 0.75, critical: 1,
};
const scoreWeights = {
  dependencyDepth: 0.18, featureImpact: 0.2, coupling: 0.2,
  usageFrequency: 0.12, queryFrequency: 0.12, architecturalCentrality: 0.18,
} as const;

function evidence(
  kind: InsightEvidenceKind,
  reference: string,
  sourceEngine: string,
  sourceVersion: string,
  details: Readonly<Record<string, unknown>> = {},
): InsightEvidence {
  return {
    evidenceId: stableId("insight_evidence", {
      kind, reference, sourceEngine, sourceVersion, details,
    }),
    kind, reference, sourceEngine, sourceVersion, details,
  };
}

function queryFrequency(sources: RepositoryInsightSources, terms: readonly string[]) {
  if (sources.queryHistory.length === 0) return 0;
  const matches = sources.queryHistory.filter((entry) => terms.some((term) =>
    entry.query.normalizedQuery.includes(term.toLowerCase()))).length;
  return bounded(matches / Math.max(1, sources.queryHistory.length));
}

function usages(sources: RepositoryInsightSources, references: readonly string[]) {
  const referenceSet = new Set(references);
  const relationships = sources.semanticGraph.relationships.filter((edge) =>
    referenceSet.has(edge.fromSymbolId) || referenceSet.has(edge.toSymbolId)).length;
  return bounded(relationships / 10);
}

export function scoreRepositoryInsight(
  severity: InsightSeverity,
  signals: Partial<Omit<InsightScore, "total">>,
): InsightScore {
  const values = {
    dependencyDepth: bounded(signals.dependencyDepth ?? 0),
    featureImpact: bounded(signals.featureImpact ?? 0),
    coupling: bounded(signals.coupling ?? 0),
    usageFrequency: bounded(signals.usageFrequency ?? 0),
    queryFrequency: bounded(signals.queryFrequency ?? 0),
    architecturalCentrality: bounded(signals.architecturalCentrality ?? 0),
  };
  const weighted = Object.entries(scoreWeights).reduce((sum, [key, weight]) =>
    sum + values[key as keyof typeof values] * weight, 0);
  return {
    total: Number((100 * (weighted * 0.8 + severityWeight[severity] * 0.2)).toFixed(3)),
    ...values,
  };
}

function materialize(
  sources: RepositoryInsightSources,
  draft: Draft,
  timestamp: string,
): RepositoryInsight {
  const supportingEvidence = [...draft.evidence].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.reference.localeCompare(b.reference) ||
    a.evidenceId.localeCompare(b.evidenceId));
  const relatedFeatures = unique(draft.features ?? []);
  const relatedSymbols = unique(draft.symbols ?? []);
  const relatedFiles = unique(draft.files ?? []);
  const insightId = stableId("insight", {
    repositoryId: sources.repositoryIntelligence.repositoryId,
    repositoryRevision: sources.repositoryIntelligence.repositoryRevision,
    type: draft.type, subject: draft.subject,
    evidence: supportingEvidence.map((item) => item.evidenceId),
  });
  return {
    insightId,
    repositoryId: sources.repositoryIntelligence.repositoryId,
    repositoryRevision: sources.repositoryIntelligence.repositoryRevision,
    type: draft.type, title: draft.title, summary: draft.summary,
    severity: draft.severity, confidence: bounded(draft.confidence),
    supportingEvidence, relatedFeatures, relatedSymbols, relatedFiles,
    score: scoreRepositoryInsight(draft.severity, draft.signals),
    createdAt: timestamp, updatedAt: timestamp,
  };
}

export function detectRepositoryInsights(
  sources: RepositoryInsightSources,
  timestamp: string,
): RepositoryInsight[] {
  const drafts: Draft[] = [];
  const intelligence = sources.repositoryIntelligence;
  const semantic = sources.semanticGraph;
  const features = sources.featureGraph;
  const graph = sources.repositoryGraph;
  const knownFiles = new Set([
    ...graph.nodes.map((item) => item.file),
    ...semantic.symbols.map((item) => item.file),
    ...intelligence.subsystems.flatMap((item) => item.files),
    ...features.features.flatMap((item) => item.files),
  ]);
  const featureByFile = new Map<string, string[]>();
  for (const feature of features.features) {
    for (const file of feature.files) {
      featureByFile.set(file, [...(featureByFile.get(file) ?? []), feature.featureId]);
    }
  }

  for (const hotspot of intelligence.architecture.hotspots) {
    const owned = featureByFile.get(hotspot.path) ?? [];
    drafts.push({
      type: "architectural hotspot", subject: hotspot.path,
      title: `Architectural hotspot: ${hotspot.path}`,
      summary: `${hotspot.path} has a published hotspot score of ${hotspot.value}.`,
      severity: hotspot.value >= 10 ? "high" : hotspot.value >= 5 ? "medium" : "low",
      confidence: 0.95,
      evidence: [evidence("file", hotspot.path, "Repository Intelligence",
        intelligence.intelligenceVersion, { hotspotValue: hotspot.value })],
      features: owned, files: [hotspot.path],
      signals: {
        featureImpact: bounded(owned.length / 4),
        queryFrequency: queryFrequency(sources, [hotspot.path]),
        architecturalCentrality: bounded(hotspot.value / 20),
      },
    });
  }

  for (const subsystem of intelligence.subsystems) {
    const coupling = subsystem.metrics.incomingDependencies +
      subsystem.metrics.outgoingDependencies;
    if (coupling >= 4) drafts.push({
      type: "highly coupled module", subject: subsystem.subsystemId,
      title: `Highly coupled module: ${subsystem.name}`,
      summary: `${subsystem.name} has ${subsystem.metrics.incomingDependencies} incoming and ${subsystem.metrics.outgoingDependencies} outgoing dependencies.`,
      severity: coupling >= 12 ? "high" : coupling >= 7 ? "medium" : "low",
      confidence: 0.92,
      evidence: [evidence("module", subsystem.subsystemId,
        "Repository Intelligence", intelligence.intelligenceVersion, {
          rootPath: subsystem.rootPath,
          incoming: subsystem.metrics.incomingDependencies,
          outgoing: subsystem.metrics.outgoingDependencies,
        })],
      files: subsystem.files,
      features: features.features.filter((item) =>
        item.owningModules.includes(subsystem.rootPath) ||
        item.files.some((file) => subsystem.files.includes(file)))
        .map((item) => item.featureId),
      signals: {
        coupling: bounded(coupling / 15),
        architecturalCentrality: bounded(
          subsystem.metrics.incomingDependencies / 10),
        queryFrequency: queryFrequency(sources,
          [subsystem.name, subsystem.rootPath]),
      },
    });
    if (coupling === 0 && subsystem.entrypoints.length === 0) drafts.push({
      type: "orphan module", subject: subsystem.subsystemId,
      title: `Orphan module: ${subsystem.name}`,
      summary: `${subsystem.name} has no published incoming or outgoing dependencies and no entry point.`,
      severity: "medium", confidence: 0.9,
      evidence: [evidence("module", subsystem.subsystemId,
        "Repository Intelligence", intelligence.intelligenceVersion, {
          rootPath: subsystem.rootPath, coupling, entrypoints: 0,
        })],
      files: subsystem.files,
      signals: { coupling: 0, architecturalCentrality: 0,
        queryFrequency: queryFrequency(sources, [subsystem.name]) },
    });
  }

  for (const cycle of intelligence.codeOrganization.cyclicDependencies) {
    if (cycle.length < 2) continue;
    drafts.push({
      type: "cyclic dependency", subject: cycle.join("->"),
      title: `Cyclic dependency across ${cycle.length} modules`,
      summary: `Published dependency analysis contains the cycle ${cycle.join(" → ")}.`,
      severity: cycle.length >= 5 ? "high" : "medium", confidence: 0.99,
      evidence: [evidence("dependency_path", cycle.join("->"),
        "Repository Intelligence", intelligence.intelligenceVersion,
        { path: cycle })],
      files: cycle.filter((item) => knownFiles.has(item)),
      signals: { dependencyDepth: bounded(cycle.length / 8),
        coupling: bounded(cycle.length / 6),
        queryFrequency: queryFrequency(sources, cycle) },
    });
  }

  for (const feature of features.features) {
    if (feature.files.length >= 5 || feature.symbolIds.length >= 10) drafts.push({
      type: "oversized feature", subject: feature.featureId,
      title: `Oversized feature: ${feature.name}`,
      summary: `${feature.name} spans ${feature.files.length} files and ${feature.symbolIds.length} symbols.`,
      severity: feature.files.length >= 10 || feature.symbolIds.length >= 25
        ? "high" : "medium",
      confidence: feature.confidence,
      evidence: [evidence("feature", feature.featureId, "Feature Intelligence",
        features.graphVersion, {
          files: feature.files.length, symbols: feature.symbolIds.length,
        })],
      features: [feature.featureId], symbols: [...feature.symbolIds],
      files: [...feature.files],
      signals: { featureImpact: bounded(feature.files.length / 12),
        usageFrequency: usages(sources, feature.symbolIds),
        queryFrequency: queryFrequency(sources, [feature.name]),
        architecturalCentrality: bounded(feature.entryPoints.length / 5) },
    });
  }

  const semanticByName = new Map(semantic.symbols.map((item) =>
    [item.name, item] as const));
  for (const candidate of unique([
    ...intelligence.symbols.orphanSymbols,
    ...intelligence.symbols.deadExports,
  ])) {
    const symbol = semantic.symbols.find((item) =>
      item.symbolId === candidate || item.qualifiedName === candidate ||
      item.name === candidate);
    drafts.push({
      type: "dead code candidate", subject: candidate,
      title: `Dead code candidate: ${symbol?.name ?? candidate}`,
      summary: `${symbol?.qualifiedName ?? candidate} is reported as an orphan symbol or dead export in published intelligence.`,
      severity: "low", confidence: symbol ? 0.88 : 0.72,
      evidence: [evidence("symbol", symbol?.symbolId ?? candidate,
        "Repository Intelligence", intelligence.intelligenceVersion, {
          classification: intelligence.symbols.deadExports.includes(candidate)
            ? "dead_export" : "orphan_symbol",
        })],
      symbols: [symbol?.symbolId ?? candidate],
      files: symbol ? [symbol.file] : [],
      signals: { usageFrequency: symbol ? usages(sources, [symbol.symbolId]) : 0,
        queryFrequency: queryFrequency(sources, [symbol?.name ?? candidate]) },
    });
  }

  for (const duplicate of intelligence.quality.duplicateImplementations) {
    const symbols = duplicate.symbols.map((name) =>
      semanticByName.get(name)?.symbolId ?? name);
    const files = duplicate.symbols.map((name) =>
      semanticByName.get(name)?.file).filter((file): file is string => Boolean(file));
    drafts.push({
      type: "duplicated implementation", subject: duplicate.signature,
      title: `Duplicated implementation: ${duplicate.signature}`,
      summary: `${duplicate.symbols.length} published symbols share the same implementation signature.`,
      severity: duplicate.symbols.length >= 4 ? "high" : "medium",
      confidence: 0.9,
      evidence: duplicate.symbols.map((name) => evidence(
        "symbol", semanticByName.get(name)?.symbolId ?? name,
        "Repository Intelligence", intelligence.intelligenceVersion,
        { signature: duplicate.signature })),
      symbols, files,
      signals: { featureImpact: bounded(unique(files.flatMap((file) =>
        featureByFile.get(file) ?? [])).length / 4),
        usageFrequency: usages(sources, symbols),
        queryFrequency: queryFrequency(sources,
          [duplicate.signature, ...duplicate.symbols]) },
    });
  }

  for (const analysis of sources.changeAnalyses.filter((item) =>
    ["high", "critical"].includes(item.risk.level) ||
    item.impact.maximumDependencyDepth >= 3)) {
    drafts.push({
      type: "high-risk dependency", subject: analysis.analysisId,
      title: `High-risk dependency: ${analysis.request.requestedTarget.value}`,
      summary: `Change intelligence reports ${analysis.risk.level} risk across dependency depth ${analysis.impact.maximumDependencyDepth}.`,
      severity: analysis.risk.level === "critical" ? "critical" : "high",
      confidence: bounded(analysis.risk.score / 100),
      evidence: analysis.impact.dependencyChains.length > 0
        ? analysis.impact.dependencyChains.map((chain) => evidence(
          "dependency_path", chain.chainId, "Change Intelligence",
          analysis.analysisId, { steps: chain.steps }))
        : [evidence("dependency_path", analysis.analysisId,
          "Change Intelligence", analysis.analysisId, {
            maximumDependencyDepth: analysis.impact.maximumDependencyDepth,
            target: analysis.request.requestedTarget,
          })],
      features: [...analysis.impact.affectedFeatureIds],
      symbols: [...analysis.impact.affectedSymbolIds],
      files: [...analysis.impact.directlyAffectedFiles,
        ...analysis.impact.indirectlyAffectedFiles],
      signals: {
        dependencyDepth: bounded(analysis.impact.maximumDependencyDepth / 8),
        featureImpact: bounded(analysis.impact.affectedFeatureIds.length / 5),
        coupling: bounded(analysis.impact.dependencyChains.length / 8),
        queryFrequency: queryFrequency(sources,
          [analysis.request.requestedTarget.value]),
      },
    });
  }

  for (const workflow of sources.workflows.filter((item) =>
    item.checkpoints.length >= 5 || item.failureCount + item.resumeCount >= 2)) {
    drafts.push({
      type: "complex workflow", subject: workflow.workflowId,
      title: `Complex workflow: ${workflow.workflowId}`,
      summary: `Workflow has ${workflow.checkpoints.length} checkpoints, ${workflow.failureCount} failures, and ${workflow.resumeCount} resumes.`,
      severity: workflow.failureCount >= 3 ? "high" : "medium",
      confidence: 0.94,
      evidence: [evidence("workflow", workflow.workflowId,
        "Workflow Orchestrator", String(workflow.workflowVersion), {
          checkpoints: workflow.checkpoints.length,
          failures: workflow.failureCount, resumes: workflow.resumeCount,
        })],
      signals: { dependencyDepth: bounded(workflow.checkpoints.length / 10),
        usageFrequency: bounded(workflow.versions.length / 10),
        queryFrequency: queryFrequency(sources, [workflow.workflowId]) },
    });
  }

  for (const [file, owners] of featureByFile) {
    if (owners.length <= 1) continue;
    drafts.push({
      type: "feature ownership anomaly", subject: file,
      title: `Feature ownership anomaly: ${file}`,
      summary: `${file} is owned by ${owners.length} published features.`,
      severity: owners.length >= 4 ? "high" : "medium", confidence: 0.96,
      evidence: owners.map((featureId) => evidence("feature", featureId,
        "Feature Intelligence", features.graphVersion, { file })),
      features: owners, files: [file],
      signals: { featureImpact: bounded(owners.length / 5),
        coupling: bounded(owners.length / 5),
        queryFrequency: queryFrequency(sources, [file]) },
    });
  }
  const semanticFiles = unique(semantic.symbols.map((item) => item.file));
  for (const file of semanticFiles.filter((item) => !featureByFile.has(item))) {
    const fileSymbols = semantic.symbols.filter((item) => item.file === file);
    drafts.push({
      type: "feature ownership anomaly", subject: file,
      title: `Unowned feature file: ${file}`,
      summary: `${file} contains ${fileSymbols.length} semantic symbols but belongs to no published feature.`,
      severity: "low", confidence: 0.85,
      evidence: fileSymbols.map((symbol) => evidence("symbol", symbol.symbolId,
        "Semantic Code Intelligence", semantic.graphVersion, { file })),
      symbols: fileSymbols.map((item) => item.symbolId), files: [file],
      signals: { queryFrequency: queryFrequency(sources, [file]) },
    });
  }

  for (const knowledge of sources.knowledge.filter((item) =>
    item.repositoryRevision !== intelligence.repositoryRevision)) {
    drafts.push({
      type: "stale knowledge", subject: knowledge.knowledgeId,
      title: `Stale knowledge: ${knowledge.subject}`,
      summary: `Knowledge version ${knowledge.version} references repository revision ${knowledge.repositoryRevision}.`,
      severity: "medium", confidence: knowledge.confidence,
      evidence: [evidence("module", knowledge.knowledgeId,
        "Repository Knowledge", String(knowledge.version), {
          knowledgeRevision: knowledge.repositoryRevision,
          currentRevision: intelligence.repositoryRevision,
        })],
      signals: { usageFrequency: bounded(knowledge.score),
        queryFrequency: queryFrequency(sources,
          [knowledge.subject, ...knowledge.content.tags]) },
    });
  }

  if (intelligence.quality.documentationCoverage < 0.7) {
    const publicSymbols = semantic.symbols.filter((item) =>
      item.visibility === "public").slice(0, 50);
    drafts.push({
      type: "documentation gap", subject: "repository-documentation",
      title: "Repository documentation coverage gap",
      summary: `Published documentation coverage is ${Number(
        intelligence.quality.documentationCoverage * 100).toFixed(1)}%.`,
      severity: intelligence.quality.documentationCoverage < 0.3
        ? "high" : "medium",
      confidence: 0.98,
      evidence: publicSymbols.length > 0
        ? publicSymbols.map((symbol) => evidence("symbol", symbol.symbolId,
          "Semantic Code Intelligence", semantic.graphVersion,
          { file: symbol.file, visibility: symbol.visibility }))
        : [evidence("module", "repository-documentation",
          "Repository Intelligence", intelligence.intelligenceVersion, {
            documentationCoverage: intelligence.quality.documentationCoverage,
          })],
      symbols: publicSymbols.map((item) => item.symbolId),
      files: publicSymbols.map((item) => item.file),
      signals: {
        featureImpact: bounded(features.features.length / 10),
        usageFrequency: usages(sources, publicSymbols.map((item) => item.symbolId)),
        queryFrequency: queryFrequency(sources,
          ["documentation", "docs", "readme"]),
      },
    });
  }

  // Repository graph is an independent integrity-backed evidence source. Its
  // centrality refines matching module/file insights without creating claims.
  const graphDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    graphDegree.set(edge.fromNodeId, (graphDegree.get(edge.fromNodeId) ?? 0) + 1);
    graphDegree.set(edge.toNodeId, (graphDegree.get(edge.toNodeId) ?? 0) + 1);
  }
  const byFileCentrality = new Map<string, number>();
  for (const node of graph.nodes) {
    byFileCentrality.set(node.file, Math.max(
      byFileCentrality.get(node.file) ?? 0, graphDegree.get(node.nodeId) ?? 0));
  }

  return drafts.map((draft) => {
    const centrality = Math.max(0, ...(draft.files ?? [])
      .map((file) => byFileCentrality.get(file) ?? 0));
    return materialize(sources, {
      ...draft,
      signals: {
        ...draft.signals,
        architecturalCentrality: Math.max(
          draft.signals.architecturalCentrality ?? 0,
          bounded(centrality / 20)),
      },
    }, timestamp);
  }).sort((a, b) => b.score.total - a.score.total ||
    b.confidence - a.confidence || a.insightId.localeCompare(b.insightId));
}

export function repositoryInsightContentHash(insight: RepositoryInsight): string {
  return stableHash({
    ...insight, createdAt: undefined, updatedAt: undefined, score: undefined,
  });
}
