import type { RepositoryStore } from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import {
  canonicalize,
  stableHash,
  stableId,
} from "../repositoryExecution/determinism.js";
import { runtimeRepositoryIntelligenceService } from "../repositoryIntelligence/service.js";
import { runtimeRepositoryIntelligenceStore } from "../repositoryIntelligence/store.js";
import { runtimeRepositoryQueryEngine } from "../repositoryQuery/service.js";
import { runtimeRepositoryInsightEngine } from "../repositoryInsight/service.js";
import { runtimeFeatureIntelligenceService } from "../featureIntelligence/service.js";
import { runtimeSemanticCodeIntelligenceService } from "../semanticCodeIntelligence/service.js";
import { runtimeChangeIntelligenceService } from "../changeIntelligence/service.js";
import { runtimeRepositoryTaskPlanner } from "../repositoryTaskPlanner/service.js";
import { runtimeRepositorySpecificationEngine } from "../repositorySpecification/service.js";
import { runtimeRepositoryExecutionCoordinator } from "../repositoryExecutionCoordinator/service.js";
import { runtimeRepositoryEvolutionIntelligenceEngine } from "../repositoryEvolution/service.js";
import { runtimeAutonomousWorkflowOrchestrator } from "../autonomousWorkflow/service.js";
import type { MetricsRegistry } from "../../observability/metrics.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import {
  runtimeRepositoryApiGatewayStore,
  type RepositoryApiGatewayStore,
} from "./store.js";
import {
  REPOSITORY_API_GATEWAY_SCHEMA_VERSION,
  REPOSITORY_GATEWAY_SERVICES,
  RepositoryGatewayError,
  type RepositoryGatewayDiagnostic,
  type RepositoryGatewayRequest,
  type RepositoryGatewayResponse,
  type RepositoryGatewayService,
  type RepositoryGatewayStatus,
} from "./types.js";

export const REPOSITORY_GATEWAY_ROUTES = Object.freeze([
  "overview",
  "query",
  "insights",
  "features",
  "semantics",
  "change-impact",
  "task-plan",
  "specification",
  "execution",
  "evolution",
] as const);

interface GatewayDependencies {
  readonly repositories: RepositoryStore;
  readonly overview: {
    getPublishedSnapshot(repositoryId: string, revision: string):
      Promise<unknown | null>;
    getRepositoryOverview(repositoryId: string, revision: string):
      Promise<unknown | null>;
    verify(): Promise<void>;
  };
  readonly query: typeof runtimeRepositoryQueryEngine;
  readonly insights: typeof runtimeRepositoryInsightEngine;
  readonly features: typeof runtimeFeatureIntelligenceService;
  readonly semantics: typeof runtimeSemanticCodeIntelligenceService;
  readonly changes: typeof runtimeChangeIntelligenceService;
  readonly taskPlanner: typeof runtimeRepositoryTaskPlanner;
  readonly specifications: typeof runtimeRepositorySpecificationEngine;
  readonly coordinator: typeof runtimeRepositoryExecutionCoordinator;
  readonly evolution: typeof runtimeRepositoryEvolutionIntelligenceEngine;
  readonly workflows: typeof runtimeAutonomousWorkflowOrchestrator;
}

export const runtimeRepositoryApiGatewayDependencies: GatewayDependencies = {
  repositories: repositoryStore,
  overview: {
    getPublishedSnapshot: (repositoryId, revision) =>
      runtimeRepositoryIntelligenceService.getPublishedSnapshot(
        repositoryId, revision),
    getRepositoryOverview: (repositoryId, revision) =>
      runtimeRepositoryIntelligenceService.getRepositoryOverview(
        repositoryId, revision),
    verify: () => runtimeRepositoryIntelligenceStore.verify(),
  },
  query: runtimeRepositoryQueryEngine,
  insights: runtimeRepositoryInsightEngine,
  features: runtimeFeatureIntelligenceService,
  semantics: runtimeSemanticCodeIntelligenceService,
  changes: runtimeChangeIntelligenceService,
  taskPlanner: runtimeRepositoryTaskPlanner,
  specifications: runtimeRepositorySpecificationEngine,
  coordinator: runtimeRepositoryExecutionCoordinator,
  evolution: runtimeRepositoryEvolutionIntelligenceEngine,
  workflows: runtimeAutonomousWorkflowOrchestrator,
};

function diagnostic(value: unknown): RepositoryGatewayDiagnostic | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.code !== "string" || typeof item.message !== "string") {
    return null;
  }
  return {
    code: item.code,
    message: item.message,
    severity: item.severity === "error" || item.severity === "warning"
      ? item.severity : "info",
    ...(typeof item.engine === "string" ? { service: item.engine } : {}),
  };
}

function payloadDiagnostics(payload: unknown): RepositoryGatewayDiagnostic[] {
  if (!payload || typeof payload !== "object") return [];
  const item = payload as Record<string, unknown>;
  const direct = Array.isArray(item.diagnostics)
    ? item.diagnostics.map(diagnostic).filter(
      (value): value is RepositoryGatewayDiagnostic => Boolean(value))
    : [];
  if (item.response && typeof item.response === "object") {
    return [...direct, ...payloadDiagnostics(item.response)];
  }
  return direct;
}

function normalizedStatus(
  payload: unknown,
): Exclude<RepositoryGatewayStatus, "error"> {
  if (!payload || typeof payload !== "object") return "ok";
  const item = payload as Record<string, unknown>;
  const lifecycle = typeof item.lifecycle === "string"
    ? item.lifecycle : undefined;
  const status = typeof item.status === "string" ? item.status : undefined;
  const nested = [
    item.query, item.task, item.specification, item.execution,
  ].find((value) => value && typeof value === "object") as
    Record<string, unknown> | undefined;
  const nestedState = nested && (
    typeof nested.lifecycle === "string" ? nested.lifecycle :
      typeof nested.status === "string" ? nested.status : undefined);
  return [lifecycle, status, nestedState].some((value) =>
    ["partial", "failed", "stale"].includes(value ?? ""))
    ? "partial" : "ok";
}

function normalizedError(error: unknown): RepositoryGatewayError {
  if (error instanceof RepositoryGatewayError) return error;
  const item = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof item?.code === "string" ? item.code : "";
  const message = typeof item?.message === "string"
    ? item.message : "Repository gateway dependency failed.";
  const details = item?.details && typeof item.details === "object"
    ? item.details as Record<string, unknown> : {};
  if (/access_denied|forbidden|ownership|not_owned/.test(code)) {
    return new RepositoryGatewayError(
      "gateway_authorization_failed", message, 403, { sourceCode: code, ...details });
  }
  if (/revision_conflict|stale|version_conflict|lineage_invalid/.test(code)) {
    return new RepositoryGatewayError(
      "gateway_stale_revision", message, 409, { sourceCode: code, ...details });
  }
  if (/unavailable|dependency/.test(code)) {
    return new RepositoryGatewayError(
      "gateway_intelligence_unavailable", message, 424,
      { sourceCode: code, ...details });
  }
  if (/empty|invalid|validation|required|not_found/.test(code)) {
    return new RepositoryGatewayError(
      "gateway_validation_failed", message, 400, { sourceCode: code, ...details });
  }
  return new RepositoryGatewayError(
    "gateway_dependency_unavailable", message, 503,
    { ...(code ? { sourceCode: code } : {}), ...details });
}

export class RepositoryApiGateway {
  constructor(
    private readonly store: RepositoryApiGatewayStore =
      runtimeRepositoryApiGatewayStore,
    private readonly dependencies: GatewayDependencies =
      runtimeRepositoryApiGatewayDependencies,
    private readonly metrics: Pick<MetricsRegistry, "recordRepositoryGateway"> =
      runtimeMetrics,
    private readonly clock: () => Date = () => new Date(),
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {}

  async execute(input: RepositoryGatewayRequest):
  Promise<RepositoryGatewayResponse> {
    const started = this.monotonicNow();
    let cacheHit = false;
    let failed = false;
    try {
      const repository = await this.authorize(input);
      const ownershipFingerprint = stableId("gateway_ownership", {
        ownerId: repository.ownerUserId,
        repositoryId: repository.repositoryId,
      });
      const requestFingerprint = stableHash(canonicalize(input.input));
      const cacheKey = stableId("repository_gateway_cache", {
        ownerId: input.ownerId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.revision,
        service: input.service,
        requestFingerprint,
      });
      const cached = await this.store.get(cacheKey, ownershipFingerprint);
      if (cached) {
        cacheHit = true;
        return this.finish(input, cached.status, cached.payload,
          cached.diagnostics);
      }

      const payload = await this.delegate(input);
      const diagnostics = payloadDiagnostics(payload);
      const status = normalizedStatus(payload);
      if (status === "partial" && diagnostics.length === 0) {
        diagnostics.push({
          code: "gateway_partial_orchestration_failure",
          message: "An existing service completed only part of its orchestration.",
          severity: "warning",
          service: input.service,
        });
      }
      const response = this.finish(input, status, payload, diagnostics);
      await this.store.put({
        cacheKey,
        schemaVersion: REPOSITORY_API_GATEWAY_SCHEMA_VERSION,
        ownerId: input.ownerId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.revision,
        ownershipFingerprint,
        service: input.service,
        requestFingerprint,
        status,
        payload,
        diagnostics,
        createdAt: response.timestamps.completedAt,
        lastAccessedAt: response.timestamps.completedAt,
        hitCount: 0,
      });
      return response;
    } catch (error) {
      failed = true;
      throw normalizedError(error);
    } finally {
      const latencyMs = Math.max(0, this.monotonicNow() - started);
      await this.store.record({
        ownerId: input.ownerId,
        endpoint: input.service,
        service: input.service,
        latencyMs,
        cacheHit,
        failed,
      }).catch(() => undefined);
      this.metrics.recordRepositoryGateway({
        endpoint: input.service,
        service: input.service,
        latencyMs,
        cacheHit,
        failed,
      });
    }
  }

  async recordFailure(
    ownerId: string,
    service: RepositoryGatewayService,
    latencyMs: number,
  ) {
    await this.store.record({
      ownerId, endpoint: service, service, latencyMs,
      cacheHit: false, failed: true,
    }).catch(() => undefined);
    this.metrics.recordRepositoryGateway({
      endpoint: service, service, latencyMs, cacheHit: false, failed: true,
    });
  }

  private finish(
    input: RepositoryGatewayRequest,
    status: RepositoryGatewayStatus,
    payload: unknown,
    diagnostics: readonly RepositoryGatewayDiagnostic[],
  ): RepositoryGatewayResponse {
    return {
      requestId: input.requestId,
      repositoryId: input.repositoryId,
      revision: input.revision,
      service: input.service,
      status,
      payload,
      diagnostics,
      timestamps: {
        receivedAt: input.receivedAt ?? this.clock().toISOString(),
        completedAt: this.clock().toISOString(),
      },
    };
  }

  private async authorize(input: RepositoryGatewayRequest) {
    const repository =
      await this.dependencies.repositories.getRepository(input.repositoryId);
    if (!repository || repository.deletionState !== "active" ||
        repository.ownerUserId !== input.ownerId) {
      throw new RepositoryGatewayError(
        "gateway_authorization_failed",
        "Repository is not owned by the requesting user.",
        403,
      );
    }
    if (!input.revision ||
        repository.currentRevision !== input.revision ||
        repository.indexedRevision !== input.revision) {
      throw new RepositoryGatewayError(
        "gateway_stale_revision",
        "Requested revision is not the current published repository revision.",
        409,
        {
          currentRevision: repository.currentRevision,
          indexedRevision: repository.indexedRevision,
        },
      );
    }
    const workflowId = input.input.workflowId;
    if (typeof workflowId === "string") {
      const workflow = await this.dependencies.workflows.get(
        input.ownerId, workflowId, input.ownerId);
      if (!workflow || workflow.ownerId !== input.ownerId ||
          workflow.repositoryId !== input.repositoryId ||
          workflow.repositoryRevision !== input.revision) {
        throw new RepositoryGatewayError(
          "gateway_authorization_failed",
          "Workflow is not owned and fenced to this repository revision.",
          403,
        );
      }
    }
    return repository;
  }

  private async delegate(input: RepositoryGatewayRequest): Promise<unknown> {
    const common = {
      tenantId: input.ownerId,
      ownerId: input.ownerId,
      repositoryOwnerId: input.ownerId,
      repositoryId: input.repositoryId,
      repositoryRevision: input.revision,
    };
    switch (input.service) {
      case "repository-overview": {
        const published = await this.dependencies.overview.getPublishedSnapshot(
          input.repositoryId, input.revision);
        if (!published) throw new RepositoryGatewayError(
          "gateway_intelligence_unavailable",
          "Published repository intelligence is unavailable.",
          424,
        );
        return this.dependencies.overview.getRepositoryOverview(
          input.repositoryId, input.revision);
      }
      case "repository-query":
        return this.dependencies.query.query({
          ...common,
          userId: input.ownerId,
          query: String(input.input.query),
          ...(typeof input.input.workflowId === "string"
            ? { workflowId: input.input.workflowId } : {}),
          ...(typeof input.input.sessionId === "string"
            ? { sessionId: input.input.sessionId } : {}),
        });
      case "repository-insights": {
        const generation = await this.dependencies.insights.generate(common);
        const filters = input.input.filters;
        if (!filters || typeof filters !== "object") return generation;
        const results = await this.dependencies.insights.navigate({
          tenantId: input.ownerId,
          ownerId: input.ownerId,
          repositoryId: input.repositoryId,
          repositoryRevision: input.revision,
          ...filters as Record<string, never>,
        });
        return { generation, results };
      }
      case "feature-navigation": {
        const navigator = await this.dependencies.features.navigate(
          input.ownerId, input.ownerId, input.repositoryId, input.revision);
        if (!navigator) throw new RepositoryGatewayError(
          "gateway_intelligence_unavailable",
          "Published feature intelligence is unavailable.",
          424,
        );
        const name = String(input.input.name);
        switch (input.input.operation) {
          case "entry-points": return navigator.entryPoints(name);
          case "exit-points": return navigator.exitPoints(name);
          case "files": return navigator.files(name);
          case "symbols": return navigator.symbols(name);
          case "dependencies": return navigator.dependencies(name);
          case "upstream": return navigator.upstream(name);
          case "downstream": return navigator.downstream(name);
          default: return navigator.byName(name);
        }
      }
      case "semantic-navigation": {
        const navigator = await this.dependencies.semantics.navigate(
          input.ownerId, input.ownerId, input.repositoryId, input.revision);
        if (!navigator) throw new RepositoryGatewayError(
          "gateway_intelligence_unavailable",
          "Published semantic intelligence is unavailable.",
          424,
        );
        const query = String(input.input.query);
        switch (input.input.operation) {
          case "references": return navigator.references(query);
          case "implementations": return navigator.implementations(query);
          case "callers": return navigator.callers(query);
          case "callees": return navigator.callees(query);
          case "inheritance": return navigator.inheritanceChain(query);
          case "dependencies": return navigator.dependencyChain(query);
          default: return navigator.definition(query);
        }
      }
      case "change-impact":
        return this.dependencies.changes.analyzePublished({
          ...common,
          workflowId: String(input.input.workflowId),
          requestedTarget: input.input.target as never,
          changeType: input.input.changeType as never,
          rationale: String(input.input.rationale),
        });
      case "task-planning":
        return this.dependencies.taskPlanner.plan({
          ...common,
          userRequest: String(input.input.objective),
          ...(typeof input.input.workflowId === "string"
            ? { workflowId: input.input.workflowId } : {}),
        });
      case "engineering-specification":
        return this.dependencies.specifications.generate({
          ...common,
          objective: String(input.input.objective),
          ...(typeof input.input.taskId === "string"
            ? { taskId: input.input.taskId } : {}),
          ...(typeof input.input.workflowId === "string"
            ? { workflowId: input.input.workflowId } : {}),
        });
      case "execution-coordination":
        return this.dependencies.coordinator.coordinate({
          ...common,
          objective: String(input.input.objective),
          workflowId: String(input.input.workflowId),
        });
      case "repository-evolution":
        return this.dependencies.evolution.compare({
          tenantId: input.ownerId,
          ownerId: input.ownerId,
          repositoryOwnerId: input.ownerId,
          repositoryId: input.repositoryId,
          baseRevision: String(input.input.baseRevision),
          targetRevision: input.revision,
        });
    }
  }

  metricsSnapshot(ownerId?: string) {
    return this.store.metrics(ownerId);
  }

  recover() {
    return this.store.recover();
  }

  async verify() {
    if (REPOSITORY_GATEWAY_ROUTES.length !==
        REPOSITORY_GATEWAY_SERVICES.length ||
        new Set(REPOSITORY_GATEWAY_ROUTES).size !==
          REPOSITORY_GATEWAY_ROUTES.length) {
      throw new RepositoryGatewayError(
        "gateway_dependency_unavailable",
        "Repository API Gateway route registration is invalid.",
        503,
      );
    }
    await Promise.all([
      this.store.verify(),
      this.dependencies.overview.verify(),
      this.dependencies.query.verify(),
      this.dependencies.insights.verify(),
      this.dependencies.features.verify(),
      this.dependencies.semantics.verify(),
      this.dependencies.changes.verify(),
      this.dependencies.taskPlanner.verify(),
      this.dependencies.specifications.verify(),
      this.dependencies.coordinator.verify(),
      this.dependencies.evolution.verify(),
      this.dependencies.workflows.verify(),
    ]);
    if (!this.metrics.recordRepositoryGateway) {
      throw new RepositoryGatewayError(
        "gateway_dependency_unavailable",
        "Repository API Gateway metrics are not registered.",
        503,
      );
    }
  }
}

export const runtimeRepositoryApiGateway = new RepositoryApiGateway();
