import type { Context } from "hono";
import { z } from "zod";
import {
  CommitShaSchema,
  QuestionTextSchema,
  RepositoryNameSchema,
  RepositoryOwnerSchema,
  SessionIdSchema,
} from "../../validation/repositorySchemas.js";
import type {
  RepositorySessionDiagnostic,
  RepositorySessionRecord,
} from "../repositorySession/types.js";
import type { RepositorySessionEngine } from "../repositorySession/service.js";

export const REPOSITORY_SESSION_API_VERSION = "repository-session-api-v1";

export const WorkflowIdSchema = z.string().trim().min(1).max(256)
  .regex(/^[a-zA-Z0-9._:-]+$/, "workflow id contains invalid characters");
export const ObjectiveTextSchema = z.string().trim().min(1)
  .max(20_000, "objective must be 20000 characters or fewer");

export const RepositorySessionApiSchemas = Object.freeze({
  create: z.object({
    owner: RepositoryOwnerSchema,
    repo: RepositoryNameSchema,
    revision: CommitShaSchema.transform((value) => value.toLowerCase()),
    workflowId: WorkflowIdSchema.optional(),
  }).strict(),
  params: z.object({ sessionId: SessionIdSchema }).strict(),
  query: z.object({ query: QuestionTextSchema }).strict(),
  objective: z.object({ objective: ObjectiveTextSchema }).strict(),
  insights: z.object({}).strict(),
});

export const REPOSITORY_SESSION_API_ROUTES = Object.freeze([
  ["POST", "/api/v1/sessions"],
  ["GET", "/api/v1/sessions"],
  ["GET", "/api/v1/sessions/:sessionId"],
  ["DELETE", "/api/v1/sessions/:sessionId"],
  ["POST", "/api/v1/sessions/:sessionId/query"],
  ["POST", "/api/v1/sessions/:sessionId/plan"],
  ["POST", "/api/v1/sessions/:sessionId/specification"],
  ["POST", "/api/v1/sessions/:sessionId/insights"],
  ["POST", "/api/v1/sessions/:sessionId/execution"],
  ["POST", "/api/v1/sessions/:sessionId/archive"],
] as const);

export interface PublicRepositorySessionDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
  readonly createdAt?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PublicRepositorySession {
  readonly sessionId: string;
  readonly repositoryId: string;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly revision: string;
  readonly workflowId: string | null;
  readonly lifecycle: RepositorySessionRecord["session"]["lifecycle"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly archivedAt: string | null;
}

export interface PublicRepositorySessionSummary extends PublicRepositorySession {
  readonly eventCount: number;
  readonly lastEventKind: RepositorySessionRecord["events"][number]["kind"] | null;
  readonly activeFeature: string | null;
  readonly activeModule: string | null;
}

export interface PublicRepositorySessionRecord {
  readonly session: PublicRepositorySession;
  readonly events: ReadonlyArray<{
    readonly eventId: string;
    readonly sequence: number;
    readonly kind: RepositorySessionRecord["events"][number]["kind"];
    readonly referenceId: string;
    readonly summary: string;
    readonly attributes: Readonly<Record<string, unknown>>;
    readonly createdAt: string;
  }>;
  readonly context: Omit<RepositorySessionRecord["context"], "sessionId">;
  readonly diagnostics: readonly PublicRepositorySessionDiagnostic[];
}

export interface RepositorySessionApiSuccess<T> {
  readonly success: true;
  readonly requestId: string;
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly retryable: false;
  readonly diagnostics: readonly PublicRepositorySessionDiagnostic[];
  readonly data: T;
}

export interface RepositorySessionApiFailure {
  readonly success: false;
  readonly requestId: string;
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly diagnostics: readonly PublicRepositorySessionDiagnostic[];
  readonly data: null;
}

const BLOCKED_KEYS = new Set([
  "tenantId",
  "ownerId",
  "userId",
  "repositoryOwnerId",
  "ownershipFingerprint",
  "persistenceVersion",
  "schemaVersion",
  "leaseToken",
  "deterministicSeed",
  "stack",
  "secret",
  "token",
]);

export function sanitizeRepositorySessionApiValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(sanitizeRepositorySessionApiValue));
  }
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !BLOCKED_KEYS.has(key))
      .map(([key, child]) => [key, sanitizeRepositorySessionApiValue(child)]),
  ));
}

function repositoryParts(repositoryId: string) {
  const separator = repositoryId.indexOf("/");
  return {
    repositoryOwner: separator < 0
      ? repositoryId : repositoryId.slice(0, separator),
    repositoryName: separator < 0
      ? "" : repositoryId.slice(separator + 1),
  };
}

export function publicRepositorySession(
  record: RepositorySessionRecord,
): PublicRepositorySession {
  return Object.freeze({
    sessionId: record.session.sessionId,
    repositoryId: record.session.repositoryId,
    ...repositoryParts(record.session.repositoryId),
    revision: record.session.repositoryRevision,
    workflowId: record.session.workflowId,
    lifecycle: record.session.lifecycle,
    createdAt: record.session.createdAt,
    updatedAt: record.session.updatedAt,
    expiresAt: record.session.expiresAt,
    archivedAt: record.session.archivedAt,
  });
}

export function publicRepositorySessionSummary(
  record: RepositorySessionRecord,
): PublicRepositorySessionSummary {
  return Object.freeze({
    ...publicRepositorySession(record),
    eventCount: record.events.length,
    lastEventKind: record.events.at(-1)?.kind ?? null,
    activeFeature: record.context.activeFeature,
    activeModule: record.context.activeModule,
  });
}

export function publicRepositorySessionDiagnostic(
  diagnostic: RepositorySessionDiagnostic,
): PublicRepositorySessionDiagnostic {
  return Object.freeze({
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    createdAt: diagnostic.createdAt,
  });
}

export function publicRepositorySessionRecord(
  record: RepositorySessionRecord,
): PublicRepositorySessionRecord {
  const { sessionId: _sessionId, ...context } = record.context;
  return Object.freeze({
    session: publicRepositorySession(record),
    events: Object.freeze(record.events.map((event) => Object.freeze({
      eventId: event.eventId,
      sequence: event.sequence,
      kind: event.kind,
      referenceId: event.referenceId,
      summary: event.summary,
      attributes: sanitizeRepositorySessionApiValue(event.attributes) as
        Readonly<Record<string, unknown>>,
      createdAt: event.createdAt,
    }))),
    context: Object.freeze({
      ...context,
      previousQuestions: Object.freeze([...context.previousQuestions]),
      previousAnswers: Object.freeze([...context.previousAnswers]),
      recentFiles: Object.freeze([...context.recentFiles]),
      recentSymbols: Object.freeze([...context.recentSymbols]),
      recentFeatures: Object.freeze([...context.recentFeatures]),
      viewedInsights: Object.freeze([...context.viewedInsights]),
      viewedPlans: Object.freeze([...context.viewedPlans]),
      viewedSpecifications: Object.freeze([...context.viewedSpecifications]),
      viewedExecutionSummaries:
        Object.freeze([...context.viewedExecutionSummaries]),
    }),
    diagnostics: Object.freeze(
      record.diagnostics.map(publicRepositorySessionDiagnostic),
    ),
  });
}

export function repositorySessionApiSuccess<T>(
  c: Context,
  input: {
    status: 200 | 201;
    code: string;
    message: string;
    data: T;
    diagnostics?: readonly PublicRepositorySessionDiagnostic[];
  },
) {
  const body: RepositorySessionApiSuccess<T> = {
    success: true,
    requestId: String(c.get("requestId") ?? "unknown"),
    status: input.status,
    code: input.code,
    message: input.message,
    retryable: false,
    diagnostics: input.diagnostics ?? [],
    data: input.data,
  };
  return c.json(body, input.status);
}

export function repositorySessionApiFailure(
  c: Context,
  input: {
    status: 400 | 401 | 403 | 404 | 409 | 424 | 429 | 500 | 503;
    code: string;
    message: string;
    retryable?: boolean;
    diagnostics?: readonly PublicRepositorySessionDiagnostic[];
  },
) {
  const body: RepositorySessionApiFailure = {
    success: false,
    requestId: String(c.get("requestId") ?? "unknown"),
    status: input.status,
    code: input.code,
    message: input.message,
    retryable: input.retryable ?? [424, 429, 500, 503].includes(input.status),
    diagnostics: input.diagnostics ?? [{
      code: input.code,
      message: input.message,
      severity: "error",
    }],
    data: null,
  };
  return c.json(body, input.status);
}

type VerifiableRepositorySessionEngine = Pick<
  RepositorySessionEngine,
  "create" | "list" | "get" | "archive" | "query" | "plan" |
  "specification" | "insights" | "coordinate" | "verify"
>;

export function verifyRepositorySessionApiContracts(
  engine: VerifiableRepositorySessionEngine,
) {
  const contracts = REPOSITORY_SESSION_API_ROUTES.map(
    ([method, path]) => `${method}:${path}`,
  );
  if (contracts.length !== 10 || new Set(contracts).size !== contracts.length) {
    throw new Error("repository_session_api_route_contract_invalid");
  }
  const validCreate = RepositorySessionApiSchemas.create.safeParse({
    owner: "acme",
    repo: "widgets",
    revision: "0".repeat(40),
    workflowId: "workflow_1",
  });
  const invalidCreate = RepositorySessionApiSchemas.create.safeParse({
    owner: "../acme",
    repo: "widgets",
    revision: "not-a-revision",
  });
  const validParams = RepositorySessionApiSchemas.params.safeParse({
    sessionId: "repository_session_0123456789abcdef01234567",
  });
  if (!validCreate.success || invalidCreate.success || !validParams.success) {
    throw new Error("repository_session_api_validator_contract_invalid");
  }
  for (const method of [
    "create", "list", "get", "archive", "query", "plan",
    "specification", "insights", "coordinate", "verify",
  ] as const) {
    if (typeof engine[method] !== "function") {
      throw new Error(`repository_session_api_dependency_missing:${method}`);
    }
  }
}
