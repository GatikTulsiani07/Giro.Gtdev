import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import { stableHash, stableId } from "../repositoryExecution/determinism.js";

export interface EngineeringApiIdempotencyKey {
  readonly ownerId: string;
  readonly route: string;
  readonly target: string;
  readonly idempotencyKey: string;
}

export interface EngineeringApiIdempotencyRecord
extends EngineeringApiIdempotencyKey {
  readonly recordId: string;
  readonly payloadHash: string;
  readonly status: number;
  readonly response: unknown;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export class EngineeringApiIdempotencyConflictError extends Error {
  readonly code = "engineering_api_idempotency_conflict";
  constructor() {
    super("Idempotency key was already used with a different payload.");
    this.name = "EngineeringApiIdempotencyConflictError";
  }
}

export interface EngineeringApiIdempotencyStore {
  get(input: EngineeringApiIdempotencyKey):
    Promise<EngineeringApiIdempotencyRecord | null>;
  put(input: EngineeringApiIdempotencyRecord):
    Promise<EngineeringApiIdempotencyRecord>;
  verify(): Promise<void>;
}

const keyOf = (input: EngineeringApiIdempotencyKey) =>
  [input.ownerId, input.route, input.target, input.idempotencyKey].join("\0");
const clone = <T>(value: T): T => structuredClone(value);

export function engineeringApiPayloadHash(payload: unknown): string {
  return stableHash(payload);
}

export function engineeringApiIdempotencyIdentity(
  input: EngineeringApiIdempotencyKey,
): string {
  return stableId("engineering_api_idempotency", input);
}

export class MemoryEngineeringApiIdempotencyStore
implements EngineeringApiIdempotencyStore {
  private readonly records =
    new Map<string, EngineeringApiIdempotencyRecord>();

  async get(input: EngineeringApiIdempotencyKey) {
    const record = this.records.get(keyOf(input));
    if (!record || Date.parse(record.expiresAt) <= Date.now()) return null;
    return clone(record);
  }

  async put(input: EngineeringApiIdempotencyRecord) {
    const key = keyOf(input);
    const existing = this.records.get(key);
    if (existing && existing.payloadHash !== input.payloadHash) {
      throw new EngineeringApiIdempotencyConflictError();
    }
    if (existing) return clone(existing);
    this.records.set(key, clone(input));
    return clone(input);
  }

  async verify(): Promise<void> {}
}

interface RpcClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

function first(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

export class PostgresEngineeringApiIdempotencyStore
implements EngineeringApiIdempotencyStore {
  constructor(private readonly client: RpcClient = supabase as SupabaseClient) {}

  private async call(name: string, input: Record<string, unknown>) {
    const { data, error } = await this.client.rpc(name, input);
    if (error) {
      if (error.message?.includes("engineering_api_idempotency_conflict")) {
        throw new EngineeringApiIdempotencyConflictError();
      }
      throw new Error("Engineering API idempotency persistence unavailable.");
    }
    return first(data);
  }

  async get(input: EngineeringApiIdempotencyKey) {
    const result = await this.call("get_engineering_api_idempotency", {
      input_owner_id: input.ownerId,
      input_route: input.route,
      input_target: input.target,
      input_idempotency_key: input.idempotencyKey,
    }) as { record?: EngineeringApiIdempotencyRecord | null } | null;
    return result?.record ? clone(result.record) : null;
  }

  async put(input: EngineeringApiIdempotencyRecord) {
    const result = await this.call("put_engineering_api_idempotency", {
      input_record: input,
    }) as { record?: EngineeringApiIdempotencyRecord } | null;
    if (!result?.record) {
      throw new Error("Engineering API idempotency persistence unavailable.");
    }
    return clone(result.record);
  }

  async verify() {
    const result = await this.call(
      "verify_engineering_platform_api_contract", {},
    ) as { valid?: boolean } | null;
    if (!result?.valid) {
      throw new Error("Engineering API persistence contract is invalid.");
    }
  }
}

export const runtimeEngineeringApiIdempotencyStore:
EngineeringApiIdempotencyStore = env.NODE_ENV === "test"
  ? new MemoryEngineeringApiIdempotencyStore()
  : new PostgresEngineeringApiIdempotencyStore();

export async function executeEngineeringApiIdempotent<T>(input: {
  readonly store: EngineeringApiIdempotencyStore;
  readonly key: EngineeringApiIdempotencyKey;
  readonly payload: unknown;
  readonly ttlMs: number;
  readonly operation: () => Promise<{ status: number; response: T }>;
}): Promise<{ status: number; response: T; replayed: boolean }> {
  const payloadHash = engineeringApiPayloadHash(input.payload);
  const existing = await input.store.get(input.key);
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new EngineeringApiIdempotencyConflictError();
    }
    return {
      status: existing.status,
      response: clone(existing.response) as T,
      replayed: true,
    };
  }
  const result = await input.operation();
  const now = new Date();
  const record = await input.store.put({
    ...input.key,
    recordId: engineeringApiIdempotencyIdentity(input.key),
    payloadHash,
    status: result.status,
    response: result.response,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
  });
  return {
    status: record.status,
    response: clone(record.response) as T,
    replayed: false,
  };
}
