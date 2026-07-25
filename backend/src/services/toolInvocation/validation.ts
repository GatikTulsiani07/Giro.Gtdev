import { Buffer } from "node:buffer";

import { stableHash, stableId } from "../repositoryExecution/determinism.js";
import type {
  ForbiddenToolCapability,
  ToolDefinition,
  ToolExecutionContext,
  ToolFailure,
  ToolInvocationIdentity,
  ToolInvocationQuotas,
  ToolInvocationRequest,
  ToolJsonSchema,
  ToolMetrics,
  ToolPermission,
  ToolStructuredOutput,
} from "./types.js";
import { ToolInvocationError } from "./types.js";

export const ALLOWED_TOOL_PERMISSIONS = Object.freeze([
  "retrieval",
  "graph_traversal",
  "intelligence_lookup",
  "planning",
  "diagnostics",
  "metrics",
] as const satisfies readonly ToolPermission[]);

export const FORBIDDEN_TOOL_CAPABILITIES = Object.freeze([
  "shell_execution",
  "git",
  "repository_mutation",
  "process_spawning",
  "secrets",
  "arbitrary_filesystem_writes",
  "unrestricted_networking",
  "arbitrary_code",
] as const satisfies readonly ForbiddenToolCapability[]);

export const EMPTY_TOOL_METRICS: ToolMetrics = Object.freeze({
  usage: 0,
  latencyMs: 0,
  timeouts: 0,
  failures: 0,
  retryCount: 0,
  payloadBytes: 0,
  cacheHits: 0,
  cacheMisses: 0,
  diagnosticGeneration: 0,
});

export function toolFailure(
  kind: ToolFailure["kind"],
  code: string,
  message: string,
  retryable = false,
  details: Readonly<Record<string, unknown>> = {},
): ToolInvocationError {
  return new ToolInvocationError({ kind, code, message, retryable, details });
}

export function immutableToolClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(clone);
  return clone;
}

function schemaError(path: string, reason: string): never {
  throw toolFailure("validation", "tool_schema_validation_failed",
    `Tool schema validation failed at ${path}: ${reason}.`, false, { path, reason });
}

export function validateSchemaDefinition(schema: ToolJsonSchema, path = "$schema"): void {
  if (!schema || typeof schema !== "object") schemaError(path, "schema must be an object");
  if (schema.type === "object") {
    const properties = schema.properties ?? {};
    if (schema.required?.some((key) => !(key in properties))) {
      schemaError(path, "required fields must be declared properties");
    }
    for (const [key, child] of Object.entries(properties)) {
      validateSchemaDefinition(child, `${path}.properties.${key}`);
    }
  } else if (schema.type === "array") {
    if (!schema.items) schemaError(path, "array schema requires items");
    validateSchemaDefinition(schema.items, `${path}.items`);
  } else if (schema.properties || schema.required || schema.items) {
    schemaError(path, "structural keywords do not match type");
  }
  if (schema.minLength !== undefined && schema.maxLength !== undefined &&
      schema.minLength > schema.maxLength) schemaError(path, "invalid string limits");
  if (schema.minimum !== undefined && schema.maximum !== undefined &&
      schema.minimum > schema.maximum) schemaError(path, "invalid numeric limits");
  if (schema.minItems !== undefined && schema.maxItems !== undefined &&
      schema.minItems > schema.maxItems) schemaError(path, "invalid array limits");
}

export function validateSchemaValue(schema: ToolJsonSchema, value: unknown, path = "$"): void {
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    schemaError(path, "value is not in enum");
  }
  switch (schema.type) {
    case "null":
      if (value !== null) schemaError(path, "expected null");
      break;
    case "boolean":
      if (typeof value !== "boolean") schemaError(path, "expected boolean");
      break;
    case "string":
      if (typeof value !== "string") schemaError(path, "expected string");
      if (value.length < (schema.minLength ?? 0) ||
          value.length > (schema.maxLength ?? Number.MAX_SAFE_INTEGER)) {
        schemaError(path, "string length is outside limits");
      }
      break;
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value) ||
          (schema.type === "integer" && !Number.isInteger(value))) schemaError(path, `expected ${schema.type}`);
      if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) {
        schemaError(path, "number is outside limits");
      }
      break;
    case "array":
      if (!Array.isArray(value)) schemaError(path, "expected array");
      if (value.length < (schema.minItems ?? 0) ||
          value.length > (schema.maxItems ?? Number.MAX_SAFE_INTEGER)) {
        schemaError(path, "array length is outside limits");
      }
      value.forEach((item, index) => validateSchemaValue(schema.items!, item, `${path}[${index}]`));
      break;
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) schemaError(path, "expected object");
      const record = value as Record<string, unknown>;
      for (const required of schema.required ?? []) {
        if (!(required in record)) schemaError(`${path}.${required}`, "required property is missing");
      }
      for (const [key, item] of Object.entries(record)) {
        const child = schema.properties?.[key];
        if (!child && schema.additionalProperties === false) schemaError(`${path}.${key}`, "unknown property");
        if (child) validateSchemaValue(child, item, `${path}.${key}`);
      }
      break;
    }
  }
}

export function validateToolDefinition(definition: ToolDefinition): void {
  if (!/^internal\.[a-z][a-z0-9_.-]*$/.test(definition.toolId)) {
    throw toolFailure("validation", "invalid_tool_id", "Tool ID is not deterministic or internal.");
  }
  if (!/^[a-z][a-z0-9.-]*-v[1-9][0-9]*$/.test(definition.version)) {
    throw toolFailure("validation", "invalid_tool_version", "Tool version is not stable.");
  }
  if (!definition.description.trim() || definition.timeoutMs <= 0 ||
      Object.values(definition.resourceLimits).some((limit) => !Number.isInteger(limit) || limit <= 0)) {
    throw toolFailure("validation", "invalid_tool_definition", "Tool metadata or limits are invalid.");
  }
  if (definition.requiredPermissions.some((permission) =>
      !ALLOWED_TOOL_PERMISSIONS.includes(permission))) {
    throw toolFailure("permission", "invalid_tool_permission", "Tool declares an unapproved permission.");
  }
  if (FORBIDDEN_TOOL_CAPABILITIES.some((capability) =>
      !definition.forbiddenCapabilities.includes(capability)) ||
      definition.forbiddenCapabilities.some((capability) =>
        !FORBIDDEN_TOOL_CAPABILITIES.includes(capability))) {
    throw toolFailure("permission", "invalid_tool_capability_boundary",
      "Tool capability boundary does not forbid every unsafe capability.");
  }
  validateSchemaDefinition(definition.inputSchema, "$inputSchema");
  validateSchemaDefinition(definition.outputSchema, "$outputSchema");
  const { capabilityHash: _hash, lifecycle: _lifecycle, ...capability } = definition;
  if (stableHash(capability) !== definition.capabilityHash) {
    throw toolFailure("validation", "tool_capability_hash_mismatch", "Tool capability hash is invalid.");
  }
}

export function validateExecutionContext(
  definition: ToolDefinition,
  context: ToolExecutionContext,
  now: Date,
): ToolExecutionContext {
  const artifacts = [
    context.repositorySnapshot,
    context.retrievalBundle,
    context.graph,
    context.intelligence,
    context.planning,
  ];
  if (artifacts.some((artifact) => artifact.published !== true || !artifact.version.trim())) {
    throw toolFailure("validation", "unpublished_tool_context",
      "Only published context versions may be used by tools.");
  }
  const execution = context.executionMetadata;
  const runtime = context.runtimeMetadata;
  if (!runtime.healthy) throw toolFailure("runtime", "runtime_unhealthy", "Runtime is unhealthy.", true);
  if (!execution.leased || Date.parse(execution.leaseExpiresAt) <= now.getTime()) {
    throw toolFailure("validation", "execution_not_leased", "Execution lease is missing or expired.", true);
  }
  if (execution.ownerId !== context.tenantId || execution.leaseOwnerId !== runtime.runtimeId ||
      runtime.ownerId !== context.tenantId) {
    throw toolFailure("permission", "tool_ownership_mismatch", "Tool ownership validation failed.");
  }
  if (definition.requiredPermissions.some((permission) =>
      !runtime.allowedPermissions.includes(permission))) {
    throw toolFailure("permission", "tool_permission_denied", "Runtime lacks a required tool permission.");
  }
  if (context.repositorySnapshot.version !== execution.repositoryRevision) {
    throw toolFailure("validation", "repository_revision_mismatch",
      "Repository snapshot does not match the leased revision.");
  }
  return immutableToolClone(context);
}

export function createInvocationIdentity(
  request: ToolInvocationRequest,
  definition: ToolDefinition,
  context: ToolExecutionContext,
  quotas: ToolInvocationQuotas,
  now: Date,
): ToolInvocationIdentity {
  const inputHash = stableHash(request.input);
  const timeoutMs = request.timeoutMs ?? definition.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 ||
      timeoutMs > definition.timeoutMs || timeoutMs > quotas.durationMs) {
    throw toolFailure("validation", "invalid_tool_timeout", "Tool timeout exceeds the approved limit.");
  }
  const inputBytes = Buffer.byteLength(JSON.stringify(request.input));
  const maxInput = Math.min(definition.resourceLimits.inputBytes, quotas.inputBytes);
  if (inputBytes > maxInput) {
    throw toolFailure("quota", "tool_input_quota_exceeded", "Tool input exceeds its byte quota.", false, {
      bytes: inputBytes,
      limit: maxInput,
    });
  }
  validateSchemaValue(definition.inputSchema, request.input);
  const scope = {
    tenantId: context.tenantId,
    executionId: context.executionMetadata.executionId,
    executionVersion: context.executionMetadata.executionVersion,
    workUnitId: context.executionMetadata.workUnitId,
    workUnitVersion: context.executionMetadata.workUnitVersion,
    runtimeId: context.runtimeMetadata.runtimeId,
    repositoryId: context.executionMetadata.repositoryId,
    repositoryRevision: context.executionMetadata.repositoryRevision,
    toolId: definition.toolId,
    toolVersion: definition.version,
    idempotencyKey: request.idempotencyKey ?? inputHash,
  };
  return Object.freeze({
    invocationId: stableId("tool_invocation", scope),
    tenantId: context.tenantId,
    executionId: context.executionMetadata.executionId,
    executionVersion: context.executionMetadata.executionVersion,
    workUnitId: context.executionMetadata.workUnitId,
    workUnitVersion: context.executionMetadata.workUnitVersion,
    runtimeId: context.runtimeMetadata.runtimeId,
    repositoryId: context.executionMetadata.repositoryId,
    repositoryRevision: context.executionMetadata.repositoryRevision,
    toolId: definition.toolId,
    toolVersion: definition.version,
    inputHash,
    timeoutMs,
    timestamp: now.toISOString(),
  });
}

export function validateToolOutput(
  definition: ToolDefinition,
  output: ToolStructuredOutput,
  quotas: ToolInvocationQuotas,
): { outputBytes: number; diagnosticsBytes: number } {
  if (output.version !== definition.version) {
    throw toolFailure("serialization", "tool_output_version_mismatch", "Tool output version is invalid.");
  }
  validateSchemaValue(definition.outputSchema, output.payload);
  const inspectLimits = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (value.length > definition.resourceLimits.resultItems) {
        throw toolFailure("quota", "tool_result_items_quota_exceeded",
          "Tool output exceeds its result item limit.");
      }
      value.forEach(inspectLimits);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(inspectLimits);
    }
  };
  inspectLimits(output.payload);
  const outputBytes = Buffer.byteLength(JSON.stringify(output));
  const diagnosticsBytes = Buffer.byteLength(JSON.stringify(output.diagnostics));
  if (outputBytes > Math.min(definition.resourceLimits.outputBytes, quotas.outputBytes)) {
    throw toolFailure("quota", "tool_output_quota_exceeded", "Tool output exceeds its byte quota.");
  }
  if (diagnosticsBytes > Math.min(
    definition.resourceLimits.diagnosticsBytes,
    quotas.storedDiagnosticsBytes,
  )) {
    throw toolFailure("quota", "tool_diagnostics_quota_exceeded", "Tool diagnostics exceed their byte quota.");
  }
  return { outputBytes, diagnosticsBytes };
}
