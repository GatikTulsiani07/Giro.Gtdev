import { stableHash } from "../repositoryExecution/determinism.js";
import type { PublishedRepositoryArtifacts } from "../repository/artifacts/repositoryArtifactStore.js";
import type { RepositorySymbolGraph } from "../repositoryGraph/graphTypes.js";
import type { RepositoryIntelligenceRecord } from "../repositoryIntelligence/types.js";
import { deterministicCrossEncoder } from "../retrieval/hybridV2/crossEncoder.js";
import { executeHybridRetrievalV2 } from "../retrieval/hybridV2/pipeline.js";
import type { SourceCandidate } from "../retrieval/hybridV2/types.js";
import type {
  ForbiddenToolCapability,
  InternalToolHandler,
  RegisteredTool,
  ToolCategory,
  ToolDefinition,
  ToolJsonSchema,
  ToolPermission,
  ToolResourceLimits,
} from "./types.js";
import { FORBIDDEN_TOOL_CAPABILITIES } from "./validation.js";

const objectSchema = (
  properties: Readonly<Record<string, ToolJsonSchema>> = {},
  required: readonly string[] = [],
  additionalProperties = false,
): ToolJsonSchema => ({ type: "object", properties, required, additionalProperties });
const stringSchema = (maxLength = 4_096): ToolJsonSchema =>
  ({ type: "string", minLength: 1, maxLength });
const integerSchema = (minimum = 0, maximum = 10_000): ToolJsonSchema =>
  ({ type: "integer", minimum, maximum });
const structuredPayloadSchema: ToolJsonSchema = objectSchema({}, [], true);
const limits: ToolResourceLimits = Object.freeze({
  inputBytes: 64 * 1024,
  outputBytes: 1024 * 1024,
  diagnosticsBytes: 64 * 1024,
  resultItems: 500,
  traversalDepth: 8,
});

function definition(
  toolId: string,
  version: string,
  category: ToolCategory,
  description: string,
  inputSchema: ToolJsonSchema,
  requiredPermissions: readonly ToolPermission[],
  overrides: Partial<ToolResourceLimits> = {},
): ToolDefinition {
  const capability = {
    toolId,
    version,
    category,
    description,
    inputSchema,
    outputSchema: structuredPayloadSchema,
    requiredPermissions: Object.freeze([...requiredPermissions]),
    forbiddenCapabilities: FORBIDDEN_TOOL_CAPABILITIES as readonly ForbiddenToolCapability[],
    timeoutMs: 5_000,
    resourceLimits: Object.freeze({ ...limits, ...overrides }),
  };
  return Object.freeze({
    ...capability,
    capabilityHash: stableHash(capability),
    lifecycle: "registered" as const,
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bounded(items: readonly unknown[], maximum: number): unknown[] {
  return items.slice(0, Math.max(0, maximum));
}

function searchable(value: unknown): string {
  try {
    return JSON.stringify(value).toLocaleLowerCase("en-US");
  } catch {
    return "";
  }
}

const retrieval: InternalToolHandler = async (input, context, signal) => {
  const request = record(input);
  const query = text(request.query).toLocaleLowerCase("en-US");
  const limit = Number(request.limit ?? 20);
  const bundle = record(context.retrievalBundle.payload);
  const candidates = records(bundle.candidates ?? bundle.results ?? bundle.items);
  const hybridCandidates = candidates.filter((candidate) =>
    typeof candidate.source === "string" &&
    candidate.result && typeof candidate.result === "object");
  if (hybridCandidates.length === candidates.length && candidates.length > 0) {
    const executed = await executeHybridRetrievalV2({
      query,
      repositoryId: context.executionMetadata.repositoryId,
      repositoryRevision: context.executionMetadata.repositoryRevision,
      candidates: hybridCandidates as unknown as readonly SourceCandidate[],
      artifacts: context.repositorySnapshot.payload as PublishedRepositoryArtifacts,
      limit,
      graph: context.graph.payload as RepositorySymbolGraph,
      intelligence: context.intelligence.payload as RepositoryIntelligenceRecord,
    }, { crossEncoder: deterministicCrossEncoder, signal });
    return {
      payload: {
        retrievalVersion: "hybrid-retrieval-v2",
        repositoryRevision: context.executionMetadata.repositoryRevision,
        results: executed.results,
        candidateCount: candidates.length,
        diagnostics: executed.diagnostics,
      },
      metrics: { cacheMisses: 1 },
    };
  }
  const terms = [...new Set(query.split(/[^a-z0-9_./-]+/u).filter(Boolean))].sort();
  const ranked = candidates.map((candidate, index) => {
    const corpus = searchable(candidate);
    const lexicalMatches = terms.filter((term) => corpus.includes(term)).length;
    const existingScore = Number(candidate.score ?? candidate.similarity ?? 0);
    return {
      candidate,
      score: Number.isFinite(existingScore) ? existingScore + lexicalMatches : lexicalMatches,
      index,
    };
  }).filter((item) => terms.length === 0 || item.score > 0)
    .sort((left, right) => right.score - left.score ||
      stableHash(left.candidate).localeCompare(stableHash(right.candidate)) ||
      left.index - right.index);
  return {
    payload: {
      retrievalVersion: "hybrid-retrieval-v2",
      repositoryRevision: context.executionMetadata.repositoryRevision,
      results: bounded(ranked.map(({ candidate, score }) => ({ ...candidate, score })), limit),
      candidateCount: candidates.length,
    },
    metrics: { cacheMisses: 1 },
  };
};

const graph: InternalToolHandler = (input, context) => {
  const request = record(input);
  const graphPayload = record(context.graph.payload);
  const nodes = records(graphPayload.nodes);
  const edges = records(graphPayload.edges);
  const nodeId = text(request.nodeId);
  const maximumDepth = Number(request.maxDepth ?? 1);
  if (!nodeId) return { payload: { nodes, edges, graphVersion: context.graph.version } };
  const selected = new Set([nodeId]);
  for (let depth = 0; depth < maximumDepth; depth += 1) {
    for (const edge of edges) {
      const source = text(edge.source ?? edge.from ?? edge.sourceNodeId);
      const target = text(edge.target ?? edge.to ?? edge.targetNodeId);
      if (selected.has(source) || selected.has(target)) {
        selected.add(source);
        selected.add(target);
      }
    }
  }
  return {
    payload: {
      graphVersion: context.graph.version,
      nodes: nodes.filter((node) => selected.has(text(node.nodeId ?? node.id))),
      edges: edges.filter((edge) =>
        selected.has(text(edge.source ?? edge.from ?? edge.sourceNodeId)) &&
        selected.has(text(edge.target ?? edge.to ?? edge.targetNodeId))),
    },
  };
};

const intelligence: InternalToolHandler = (input, context) => {
  const query = text(record(input).query).toLocaleLowerCase("en-US");
  const payload = record(context.intelligence.payload);
  const matches = Object.entries(payload)
    .filter(([key, value]) => !query || `${key} ${searchable(value)}`.toLocaleLowerCase("en-US").includes(query))
    .sort(([left], [right]) => left.localeCompare(right));
  return { payload: { intelligenceVersion: context.intelligence.version, matches: Object.fromEntries(matches) } };
};

const planning: InternalToolHandler = (_input, context) => ({
  payload: {
    planningVersion: context.planning.version,
    repositoryRevision: context.executionMetadata.repositoryRevision,
    plan: context.planning.payload,
  },
});

const statistics: InternalToolHandler = (_input, context) => {
  const snapshot = record(context.repositorySnapshot.payload);
  const graphPayload = record(context.graph.payload);
  const retrievalPayload = record(context.retrievalBundle.payload);
  const intelligencePayload = record(context.intelligence.payload);
  return {
    payload: {
      repositoryRevision: context.executionMetadata.repositoryRevision,
      files: records(snapshot.files ?? snapshot.entries).length,
      symbols: records(graphPayload.nodes).length,
      dependencies: records(graphPayload.edges).length,
      retrievalItems: records(retrievalPayload.candidates ?? retrievalPayload.results).length,
      intelligenceSections: Object.keys(intelligencePayload).length,
    },
  };
};

const dependencyLookup: InternalToolHandler = (input, context) => {
  const request = record(input);
  const symbol = text(request.symbol);
  const edges = records(record(context.graph.payload).edges);
  const matches = edges.filter((edge) => [
    edge.source, edge.target, edge.from, edge.to, edge.sourceNodeId, edge.targetNodeId,
  ].some((value) => text(value) === symbol));
  return { payload: { symbol, dependencies: matches } };
};

const symbolLookup: InternalToolHandler = (input, context) => {
  const request = record(input);
  const query = text(request.query).toLocaleLowerCase("en-US");
  const limit = Number(request.limit ?? 50);
  const nodes = records(record(context.graph.payload).nodes);
  const symbols = nodes.filter((node) =>
    [node.name, node.qualifiedName, node.nodeId].some((value) =>
      text(value).toLocaleLowerCase("en-US").includes(query)))
    .sort((left, right) => stableHash(left).localeCompare(stableHash(right)));
  return { payload: { query, symbols: bounded(symbols, limit) } };
};

const fileLookup: InternalToolHandler = (input, context) => {
  const request = record(input);
  const query = text(request.query).toLocaleLowerCase("en-US");
  const limit = Number(request.limit ?? 50);
  const snapshot = record(context.repositorySnapshot.payload);
  const files = records(snapshot.files ?? snapshot.entries).filter((file) =>
    text(file.path ?? file.filePath ?? file.name).toLocaleLowerCase("en-US").includes(query))
    .sort((left, right) => text(left.path ?? left.filePath)
      .localeCompare(text(right.path ?? right.filePath)));
  return { payload: { query, files: bounded(files, limit) } };
};

const diagnostics: InternalToolHandler = (_input, context) => {
  const sources = [
    ["retrieval", record(context.retrievalBundle.payload).diagnostics],
    ["graph", record(context.graph.payload).diagnostics],
    ["intelligence", record(context.intelligence.payload).diagnostics],
    ["planning", record(context.planning.payload).diagnostics],
  ] as const;
  return {
    payload: {
      repositoryRevision: context.executionMetadata.repositoryRevision,
      sources: sources.map(([source, items]) => ({ source, diagnostics: Array.isArray(items) ? items : [] })),
    },
  };
};

const metrics: InternalToolHandler = (_input, context) => {
  const sources = [
    ["retrieval", record(context.retrievalBundle.payload).metrics],
    ["graph", record(context.graph.payload).metrics],
    ["intelligence", record(context.intelligence.payload).metrics],
    ["planning", record(context.planning.payload).metrics],
  ] as const;
  return { payload: { sources: sources.map(([source, values]) => ({ source, values: record(values) })) } };
};

const querySchema = objectSchema({
  query: stringSchema(),
  limit: integerSchema(1, 500),
}, ["query"]);

export function builtInTools(): readonly RegisteredTool[] {
  return Object.freeze([
    { definition: definition("internal.hybrid-retrieval-v2", "hybrid-retrieval-v2-v1", "Retrieval",
      "Deterministically ranks the current published retrieval bundle.", querySchema, ["retrieval"]), handler: retrieval },
    { definition: definition("internal.repository-graph", "repository-graph-tool-v1", "Repository Graph",
      "Traverses the current published repository graph.", objectSchema({
        nodeId: { type: "string", maxLength: 1_024 },
        maxDepth: integerSchema(0, 8),
      }), ["graph_traversal"], { traversalDepth: 8 }), handler: graph },
    { definition: definition("internal.repository-intelligence", "repository-intelligence-tool-v1",
      "Repository Intelligence", "Reads the current published repository intelligence.",
      objectSchema({ query: { type: "string", maxLength: 4_096 } }), ["intelligence_lookup"]), handler: intelligence },
    { definition: definition("internal.repository-planning", "repository-planning-tool-v1",
      "Repository Planning", "Reads the current published repository plan.",
      objectSchema(), ["planning"]), handler: planning },
    { definition: definition("internal.repository-statistics", "repository-statistics-tool-v1",
      "Metrics", "Calculates bounded repository statistics from published context.",
      objectSchema(), ["metrics"]), handler: statistics },
    { definition: definition("internal.dependency-lookup", "dependency-lookup-tool-v1",
      "Repository Graph", "Looks up dependencies in the published graph.",
      objectSchema({ symbol: stringSchema(1_024) }, ["symbol"]), ["graph_traversal"]), handler: dependencyLookup },
    { definition: definition("internal.symbol-lookup", "symbol-lookup-tool-v1",
      "Search", "Looks up symbols in the published graph.", querySchema, ["graph_traversal"]), handler: symbolLookup },
    { definition: definition("internal.file-lookup", "file-lookup-tool-v1",
      "Search", "Looks up files in the published repository snapshot.", querySchema, ["retrieval"]), handler: fileLookup },
    { definition: definition("internal.diagnostics", "diagnostics-tool-v1",
      "Diagnostics", "Reads diagnostics embedded in published tool context.",
      objectSchema(), ["diagnostics"]), handler: diagnostics },
    { definition: definition("internal.metrics", "metrics-tool-v1",
      "Metrics", "Reads metrics embedded in published tool context.",
      objectSchema(), ["metrics"]), handler: metrics },
  ]);
}
