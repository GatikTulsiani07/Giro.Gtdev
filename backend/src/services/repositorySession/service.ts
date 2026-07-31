import type { RepositoryStore } from "../repository/store/repositoryStore.js";
import { repositoryStore } from "../repository/store/runtimeRepositoryStore.js";
import { stableId } from "../repositoryExecution/determinism.js";
import { runtimeAutonomousWorkflowOrchestrator } from "../autonomousWorkflow/service.js";
import { runtimeRepositoryQueryEngine } from "../repositoryQuery/service.js";
import { runtimeRepositoryTaskPlanner } from "../repositoryTaskPlanner/service.js";
import { runtimeRepositorySpecificationEngine } from "../repositorySpecification/service.js";
import { runtimeRepositoryExecutionCoordinator } from "../repositoryExecutionCoordinator/service.js";
import { runtimeRepositoryInsightEngine } from "../repositoryInsight/service.js";
import type { MetricsRegistry } from "../../observability/metrics.js";
import { runtimeMetrics } from "../../observability/metrics.js";
import {
  runtimeRepositorySessionStore,
  type RepositorySessionStore,
} from "./store.js";
import {
  REPOSITORY_SESSION_SCHEMA_VERSION,
  RepositorySessionError,
  type CreateRepositorySessionInput,
  type RepositorySessionContext,
  type RepositorySessionDiagnostic,
  type RepositorySessionEvent,
  type RepositorySessionEventKind,
  type RepositorySessionLimits,
  type RepositorySessionRecord,
  type RepositorySessionViewInput,
} from "./types.js";

export const DEFAULT_REPOSITORY_SESSION_LIMITS:
RepositorySessionLimits = Object.freeze({
  maximumHistory: 100,
  expirationMs: 30 * 24 * 60 * 60 * 1_000,
});

interface RepositorySessionDependencies {
  readonly repositories: RepositoryStore;
  readonly workflows: typeof runtimeAutonomousWorkflowOrchestrator;
  readonly query: typeof runtimeRepositoryQueryEngine;
  readonly taskPlanner: typeof runtimeRepositoryTaskPlanner;
  readonly specifications: typeof runtimeRepositorySpecificationEngine;
  readonly coordinator: typeof runtimeRepositoryExecutionCoordinator;
  readonly insights: typeof runtimeRepositoryInsightEngine;
}

export const runtimeRepositorySessionDependencies:
RepositorySessionDependencies = {
  repositories: repositoryStore,
  workflows: runtimeAutonomousWorkflowOrchestrator,
  query: runtimeRepositoryQueryEngine,
  taskPlanner: runtimeRepositoryTaskPlanner,
  specifications: runtimeRepositorySpecificationEngine,
  coordinator: runtimeRepositoryExecutionCoordinator,
  insights: runtimeRepositoryInsightEngine,
};

export function deterministicRepositorySessionId(
  input: CreateRepositorySessionInput,
) {
  return stableId("repository_session", {
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    userId: input.userId,
    repositoryId: input.repositoryId,
    repositoryRevision: input.repositoryRevision,
    workflowId: input.workflowId ?? null,
  });
}

function emptyContext(
  sessionId: string, workflowId: string | null, at: string,
): RepositorySessionContext {
  return {
    sessionId,
    contextVersion: 1,
    activeFeature: null,
    activeModule: null,
    activeWorkflow: workflowId,
    activeArchitecture: null,
    activeChangeAnalysis: null,
    previousQuestions: [],
    previousAnswers: [],
    recentFiles: [],
    recentSymbols: [],
    recentFeatures: [],
    viewedInsights: [],
    viewedPlans: [],
    viewedSpecifications: [],
    viewedExecutionSummaries: [],
    updatedAt: at,
  };
}

function bounded(
  current: readonly string[], values: readonly string[], maximum: number,
) {
  const ordered = [...current];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const existing = ordered.indexOf(normalized);
    if (existing >= 0) ordered.splice(existing, 1);
    ordered.push(normalized);
  }
  return ordered.slice(-maximum);
}

interface EventInput {
  readonly kind: RepositorySessionEventKind;
  readonly referenceId: string;
  readonly summary: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly module?: string;
  readonly architecture?: string;
  readonly changeAnalysis?: string;
}

export class RepositorySessionEngine {
  constructor(
    private readonly store: RepositorySessionStore =
      runtimeRepositorySessionStore,
    private readonly dependencies: RepositorySessionDependencies =
      runtimeRepositorySessionDependencies,
    private readonly limits: RepositorySessionLimits =
      DEFAULT_REPOSITORY_SESSION_LIMITS,
    private readonly metrics: Pick<MetricsRegistry, "recordRepositorySessions"> =
      runtimeMetrics,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(limits.maximumHistory) ||
        limits.maximumHistory < 1 ||
        !Number.isSafeInteger(limits.expirationMs) ||
        limits.expirationMs < 1) {
      throw new RepositorySessionError(
        "repository_session_limits_invalid",
        "Repository session history and expiration limits must be positive integers.");
    }
  }

  async create(input: CreateRepositorySessionInput) {
    await this.authorizeRepository(input.ownerId, input.userId,
      input.repositoryOwnerId, input.repositoryId,
      input.repositoryRevision);
    if (input.workflowId) await this.authorizeWorkflow(
      input.tenantId, input.ownerId, input.repositoryId,
      input.repositoryRevision, input.workflowId);
    const sessionId = deterministicRepositorySessionId(input);
    const existing = await this.store.get(
      input.tenantId, input.ownerId, sessionId);
    if (existing && ["active", "recovered"].includes(
      existing.session.lifecycle) &&
      Date.parse(existing.session.expiresAt) > this.clock().getTime()) {
      await this.store.recordReuse(input.tenantId, input.ownerId, sessionId);
      await this.recordMetrics(input.tenantId);
      return (await this.store.get(
        input.tenantId, input.ownerId, sessionId))!;
    }
    const createdAt = input.requestedAt
      ? new Date(input.requestedAt).toISOString()
      : this.clock().toISOString();
    const record: RepositorySessionRecord = {
      session: {
        sessionId,
        schemaVersion: REPOSITORY_SESSION_SCHEMA_VERSION,
        persistenceVersion: 1,
        tenantId: input.tenantId,
        repositoryId: input.repositoryId,
        repositoryRevision: input.repositoryRevision,
        ownerId: input.ownerId,
        userId: input.userId,
        workflowId: input.workflowId ?? null,
        lifecycle: "active",
        createdAt,
        updatedAt: createdAt,
        expiresAt: new Date(
          Date.parse(createdAt) + this.limits.expirationMs).toISOString(),
        archivedAt: null,
      },
      events: [],
      context: emptyContext(
        sessionId, input.workflowId ?? null, createdAt),
      diagnostics: [],
      reuseCount: 0,
      recoveryCount: 0,
    };
    const saved = await this.store.save(record);
    await this.recordMetrics(input.tenantId);
    return saved;
  }

  async get(tenantId: string, ownerId: string, sessionId: string) {
    const record = await this.requireSession(tenantId, ownerId, sessionId);
    return record;
  }

  async list(tenantId: string, ownerId: string) {
    const records = await this.store.list(tenantId, ownerId);
    for (const record of records) {
      await this.authorizeSessionRecord(tenantId, ownerId, record);
    }
    return records;
  }

  async recordView(input: RepositorySessionViewInput) {
    const record = await this.requireSession(
      input.tenantId, input.ownerId, input.sessionId);
    return this.append(record, [{
      kind: input.kind,
      referenceId: input.referenceId,
      summary: input.summary ?? `Viewed ${input.kind} ${input.referenceId}.`,
      ...(input.module ? { module: input.module } : {}),
      ...(input.architecture ? { architecture: input.architecture } : {}),
      ...(input.changeAnalysis
        ? { changeAnalysis: input.changeAnalysis } : {}),
    }]);
  }

  async query(input: {
    tenantId: string;
    ownerId: string;
    sessionId: string;
    question: string;
  }) {
    const begun = await this.begin(input.tenantId, input.ownerId,
      input.sessionId);
    const result = await this.dependencies.query.query({
      tenantId: begun.session.tenantId,
      userId: begun.session.userId,
      repositoryOwnerId: begun.session.ownerId,
      repositoryId: begun.session.repositoryId,
      repositoryRevision: begun.session.repositoryRevision,
      query: input.question,
      sessionId: begun.session.sessionId,
      ...(begun.context.activeWorkflow
        ? { workflowId: begun.context.activeWorkflow } : {}),
    });
    const events: EventInput[] = [{
      kind: "query",
      referenceId: result.query.queryId,
      summary: input.question.trim(),
      attributes: { intents: result.query.intents },
    }, {
      kind: "answer",
      referenceId: result.query.queryId,
      summary: result.response?.summary ??
        "The existing Query Engine returned no grounded summary.",
      attributes: { confidence: result.response?.confidence ?? 0 },
      ...(result.response?.architecture
        ? { architecture: begun.session.repositoryRevision } : {}),
      ...(result.response?.changeImpact
        ? { changeAnalysis: result.query.queryId } : {}),
    }];
    for (const file of result.response?.relevantFiles ?? []) events.push({
      kind: "file", referenceId: file, summary: `Viewed file ${file}.`,
    });
    for (const symbol of result.response?.relevantSymbols ?? []) events.push({
      kind: "symbol", referenceId: symbol.symbolId,
      summary: `Viewed symbol ${symbol.qualifiedName}.`,
      attributes: { file: symbol.file },
    });
    for (const feature of result.response?.relatedFeatures ?? []) events.push({
      kind: "feature", referenceId: feature.featureId,
      summary: `Viewed feature ${feature.name}.`,
      module: feature.owningModules[0],
    });
    await this.complete(begun, events);
    return result;
  }

  async plan(input: {
    tenantId: string;
    ownerId: string;
    sessionId: string;
    objective: string;
  }) {
    const begun = await this.begin(input.tenantId, input.ownerId,
      input.sessionId);
    const result = await this.dependencies.taskPlanner.plan({
      tenantId: begun.session.tenantId,
      ownerId: begun.session.ownerId,
      repositoryOwnerId: begun.session.ownerId,
      repositoryId: begun.session.repositoryId,
      repositoryRevision: begun.session.repositoryRevision,
      userRequest: input.objective,
      ...(begun.context.activeWorkflow
        ? { workflowId: begun.context.activeWorkflow } : {}),
    });
    await this.complete(begun, [{
      kind: "plan",
      referenceId: result.task.taskId,
      summary: result.task.userRequest,
      attributes: { category: result.task.category },
      module: result.impact.affectedModules[0],
    }, ...result.impact.affectedFiles.map((file) => ({
      kind: "file" as const, referenceId: file,
      summary: `Plan references file ${file}.`,
    })), ...result.impact.affectedFeatures.map((feature) => ({
      kind: "feature" as const, referenceId: feature,
      summary: `Plan references feature ${feature}.`,
    }))]);
    return result;
  }

  async specification(input: {
    tenantId: string;
    ownerId: string;
    sessionId: string;
    objective: string;
  }) {
    const begun = await this.begin(input.tenantId, input.ownerId,
      input.sessionId);
    const taskId = begun.context.viewedPlans.at(-1);
    const result = await this.dependencies.specifications.generate({
      tenantId: begun.session.tenantId,
      ownerId: begun.session.ownerId,
      repositoryOwnerId: begun.session.ownerId,
      repositoryId: begun.session.repositoryId,
      repositoryRevision: begun.session.repositoryRevision,
      objective: input.objective,
      ...(taskId ? { taskId } : {}),
      ...(begun.context.activeWorkflow
        ? { workflowId: begun.context.activeWorkflow } : {}),
    });
    await this.complete(begun, [{
      kind: "specification",
      referenceId: result.specification.specificationId,
      summary: result.specification.title,
      attributes: { type: result.specification.type },
    }]);
    return result;
  }

  async coordinate(input: {
    tenantId: string;
    ownerId: string;
    sessionId: string;
    objective: string;
  }) {
    const begun = await this.begin(input.tenantId, input.ownerId,
      input.sessionId);
    const workflowId = begun.context.activeWorkflow;
    if (!workflowId) throw new RepositorySessionError(
      "repository_session_workflow_required",
      "Execution coordination requires an active owned workflow.");
    const result = await this.dependencies.coordinator.coordinate({
      tenantId: begun.session.tenantId,
      ownerId: begun.session.ownerId,
      repositoryOwnerId: begun.session.ownerId,
      repositoryId: begun.session.repositoryId,
      repositoryRevision: begun.session.repositoryRevision,
      workflowId,
      objective: input.objective,
    });
    await this.complete(begun, [{
      kind: "execution_summary",
      referenceId: result.execution.executionId,
      summary: result.summary
        ? `Execution readiness: ${result.summary.readinessStatus}.`
        : `Execution status: ${result.execution.status}.`,
      attributes: { status: result.execution.status },
    }]);
    return result;
  }

  async insights(input: {
    tenantId: string;
    ownerId: string;
    sessionId: string;
  }) {
    const begun = await this.begin(input.tenantId, input.ownerId,
      input.sessionId);
    const result = await this.dependencies.insights.generate({
      tenantId: begun.session.tenantId,
      ownerId: begun.session.ownerId,
      repositoryOwnerId: begun.session.ownerId,
      repositoryId: begun.session.repositoryId,
      repositoryRevision: begun.session.repositoryRevision,
    });
    await this.complete(begun, result.insights.map((insight) => ({
      kind: "insight" as const,
      referenceId: insight.insightId,
      summary: insight.title,
      attributes: { type: insight.type, severity: insight.severity },
    })));
    return result;
  }

  async archive(tenantId: string, ownerId: string, sessionId: string) {
    const record = await this.store.get(tenantId, ownerId, sessionId);
    if (!record) throw new RepositorySessionError(
      "repository_session_not_found", "Repository session was not found.");
    await this.authorizeSessionRecord(tenantId, ownerId, record);
    const archived = await this.store.archive(
      tenantId, ownerId, sessionId, this.clock().toISOString());
    if (!archived) throw new RepositorySessionError(
      "repository_session_not_found", "Repository session was not found.");
    await this.recordMetrics(tenantId);
    return archived;
  }

  async recover() {
    const recovered = await this.store.recover(this.clock().toISOString());
    await this.recordMetrics();
    return recovered;
  }
  collect(tenantId: string, retainedSessions = 100) {
    return this.store.collect(tenantId, retainedSessions);
  }
  metricsSnapshot(tenantId?: string) {
    return this.store.metrics(tenantId);
  }
  async verify() {
    await Promise.all([
      this.store.verify(),
      this.dependencies.workflows.verify(),
      this.dependencies.query.verify(),
      this.dependencies.taskPlanner.verify(),
      this.dependencies.specifications.verify(),
      this.dependencies.coordinator.verify(),
      this.dependencies.insights.verify(),
    ]);
    if (!this.metrics.recordRepositorySessions) {
      throw new RepositorySessionError(
        "repository_session_metrics_unregistered",
        "Repository session metrics are not registered.");
    }
  }

  private async authorizeRepository(
    ownerId: string, userId: string, repositoryOwnerId: string,
    repositoryId: string, revision: string,
  ) {
    const repository =
      await this.dependencies.repositories.getRepository(repositoryId);
    if (!repository || repository.deletionState !== "active" ||
        ownerId !== userId || ownerId !== repositoryOwnerId ||
        repository.ownerUserId !== ownerId) {
      throw new RepositorySessionError(
        "repository_session_access_denied",
        "Repository is not owned by the session user.");
    }
    if (repository.currentRevision !== revision ||
        repository.indexedRevision !== revision) {
      throw new RepositorySessionError(
        "repository_session_revision_conflict",
        "Session revision is not the current published repository revision.");
    }
    return repository;
  }

  private async authorizeWorkflow(
    tenantId: string, ownerId: string, repositoryId: string,
    revision: string, workflowId: string,
  ) {
    const workflow = await this.dependencies.workflows.get(
      tenantId, workflowId, ownerId);
    if (!workflow || workflow.ownerId !== ownerId ||
        workflow.repositoryId !== repositoryId ||
        workflow.repositoryRevision !== revision) {
      throw new RepositorySessionError(
        "repository_session_workflow_access_denied",
        "Workflow is not owned and fenced to the session revision.");
    }
  }

  private async requireSession(
    tenantId: string, ownerId: string, sessionId: string,
  ) {
    const record = await this.store.get(tenantId, ownerId, sessionId);
    if (!record) throw new RepositorySessionError(
      "repository_session_not_found", "Repository session was not found.");
    if (!["active", "recovered"].includes(record.session.lifecycle)) {
      throw new RepositorySessionError(
        "repository_session_inactive",
        "Repository session is not active.");
    }
    if (Date.parse(record.session.expiresAt) <= this.clock().getTime()) {
      await this.store.archive(
        tenantId, ownerId, sessionId, this.clock().toISOString());
      throw new RepositorySessionError(
        "repository_session_expired", "Repository session has expired.");
    }
    await this.authorizeSessionRecord(tenantId, ownerId, record);
    return record;
  }

  private async authorizeSessionRecord(
    tenantId: string,
    ownerId: string,
    record: RepositorySessionRecord,
  ) {
    await this.authorizeRepository(
      record.session.ownerId, record.session.userId,
      record.session.ownerId, record.session.repositoryId,
      record.session.repositoryRevision);
    if (record.context.activeWorkflow) await this.authorizeWorkflow(
      tenantId, ownerId, record.session.repositoryId,
      record.session.repositoryRevision, record.context.activeWorkflow);
  }

  private async begin(
    tenantId: string, ownerId: string, sessionId: string,
  ) {
    const record = await this.requireSession(tenantId, ownerId, sessionId);
    const at = this.clock().toISOString();
    return this.store.save({
      ...record,
      session: {
        ...record.session,
        lifecycle: "interrupted",
        updatedAt: at,
      },
    }, record.session.persistenceVersion);
  }

  private complete(record: RepositorySessionRecord, events: EventInput[]) {
    return this.append(record, events, "active");
  }

  private async append(
    record: RepositorySessionRecord,
    inputs: readonly EventInput[],
    lifecycle: "active" | "recovered" = record.session.lifecycle === "recovered"
      ? "recovered" : "active",
  ) {
    const at = this.clock().toISOString();
    const nextSequence = (record.events.at(-1)?.sequence ?? 0) + 1;
    const created = inputs.map((input, index): RepositorySessionEvent => ({
      eventId: stableId("repository_session_event", {
        sessionId: record.session.sessionId,
        sequence: nextSequence + index,
        kind: input.kind,
        referenceId: input.referenceId,
      }),
      sessionId: record.session.sessionId,
      sequence: nextSequence + index,
      kind: input.kind,
      referenceId: input.referenceId,
      summary: input.summary.trim().slice(0, 2_000),
      attributes: input.attributes ?? {},
      createdAt: at,
    }));
    const maximum = this.limits.maximumHistory;
    const byKind = (kind: RepositorySessionEventKind) =>
      created.filter((item) => item.kind === kind)
        .map((item) => item.referenceId);
    const questions = created.filter((item) => item.kind === "query")
      .map((item) => item.summary);
    const answers = created.filter((item) => item.kind === "answer")
      .map((item) => item.summary);
    const latest = inputs.at(-1);
    const context: RepositorySessionContext = {
      ...record.context,
      contextVersion: record.context.contextVersion + 1,
      activeFeature:
        byKind("feature").at(-1) ?? record.context.activeFeature,
      activeModule:
        [...inputs].reverse().find((item) => item.module)?.module ??
        record.context.activeModule,
      activeWorkflow: record.context.activeWorkflow,
      activeArchitecture:
        [...inputs].reverse().find((item) => item.architecture)?.architecture ??
        record.context.activeArchitecture,
      activeChangeAnalysis:
        [...inputs].reverse().find((item) =>
          item.changeAnalysis)?.changeAnalysis ??
        record.context.activeChangeAnalysis,
      previousQuestions: bounded(
        record.context.previousQuestions, questions, maximum),
      previousAnswers: bounded(
        record.context.previousAnswers, answers, maximum),
      recentFiles: bounded(
        record.context.recentFiles, byKind("file"), maximum),
      recentSymbols: bounded(
        record.context.recentSymbols, byKind("symbol"), maximum),
      recentFeatures: bounded(
        record.context.recentFeatures, byKind("feature"), maximum),
      viewedInsights: bounded(
        record.context.viewedInsights, byKind("insight"), maximum),
      viewedPlans: bounded(
        record.context.viewedPlans, byKind("plan"), maximum),
      viewedSpecifications: bounded(
        record.context.viewedSpecifications,
        byKind("specification"), maximum),
      viewedExecutionSummaries: bounded(
        record.context.viewedExecutionSummaries,
        byKind("execution_summary"), maximum),
      updatedAt: at,
    };
    const saved = await this.store.save({
      ...record,
      session: {
        ...record.session,
        lifecycle,
        updatedAt: at,
        expiresAt: new Date(
          Date.parse(at) + this.limits.expirationMs).toISOString(),
      },
      events: [...record.events, ...created].slice(-maximum),
      context,
      diagnostics: latest ? record.diagnostics : [
        ...record.diagnostics,
        this.diagnostic(record.session.sessionId,
          "repository_session_empty_operation",
          "Session operation produced no durable references.", at),
      ],
    }, record.session.persistenceVersion);
    await this.recordMetrics(record.session.tenantId);
    return saved;
  }

  private diagnostic(
    sessionId: string, code: string, message: string, at: string,
  ): RepositorySessionDiagnostic {
    return {
      diagnosticId: stableId("repository_session_diagnostic", {
        sessionId, code, at,
      }),
      sessionId, code, message, severity: "info", createdAt: at,
    };
  }

  private async recordMetrics(tenantId?: string) {
    this.metrics.recordRepositorySessions(
      await this.store.metrics(tenantId));
  }
}

export const runtimeRepositorySessionEngine =
  new RepositorySessionEngine();
