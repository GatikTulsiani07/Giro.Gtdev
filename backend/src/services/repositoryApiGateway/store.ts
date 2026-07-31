import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import {
  REPOSITORY_API_GATEWAY_SCHEMA_VERSION,
  RepositoryGatewayError,
  type RepositoryGatewayCacheRecord,
  type RepositoryGatewayMetricSample,
  type RepositoryGatewayMetrics,
} from "./types.js";

export interface RepositoryApiGatewayStore {
  get(cacheKey: string, ownershipFingerprint: string):
    Promise<RepositoryGatewayCacheRecord | null>;
  put(record: RepositoryGatewayCacheRecord):
    Promise<RepositoryGatewayCacheRecord>;
  record(sample: RepositoryGatewayMetricSample): Promise<void>;
  metrics(ownerId?: string): Promise<RepositoryGatewayMetrics>;
  recover(): Promise<number>;
  verify(): Promise<void>;
}

const clone = <T>(value: T): T => structuredClone(value);
const emptyMetrics = (): RepositoryGatewayMetrics => ({
  endpointUsage: {},
  serviceDistribution: {},
  totalLatencyMs: 0,
  cacheHits: 0,
  failures: 0,
});

export class MemoryRepositoryApiGatewayStore
implements RepositoryApiGatewayStore {
  private readonly cache = new Map<string, RepositoryGatewayCacheRecord>();
  private readonly samples: RepositoryGatewayMetricSample[] = [];

  hydrate(record: RepositoryGatewayCacheRecord) {
    this.cache.set(record.cacheKey, clone(record));
  }

  async get(cacheKey: string, ownershipFingerprint: string) {
    const record = this.cache.get(cacheKey);
    if (!record || record.ownershipFingerprint !== ownershipFingerprint ||
        record.schemaVersion !== REPOSITORY_API_GATEWAY_SCHEMA_VERSION) {
      return null;
    }
    const accessed = {
      ...record,
      lastAccessedAt: new Date().toISOString(),
      hitCount: record.hitCount + 1,
    };
    this.cache.set(cacheKey, accessed);
    return clone(accessed);
  }

  async put(record: RepositoryGatewayCacheRecord) {
    const current = this.cache.get(record.cacheKey);
    if (current &&
        (current.ownerId !== record.ownerId ||
         current.repositoryId !== record.repositoryId ||
         current.repositoryRevision !== record.repositoryRevision ||
         current.ownershipFingerprint !== record.ownershipFingerprint ||
         current.requestFingerprint !== record.requestFingerprint)) {
      throw new RepositoryGatewayError(
        "gateway_dependency_unavailable",
        "Gateway cache identity conflict.",
        503,
      );
    }
    const saved = clone(current ?? record);
    this.cache.set(record.cacheKey, saved);
    return clone(saved);
  }

  async record(sample: RepositoryGatewayMetricSample) {
    this.samples.push(clone(sample));
  }

  async metrics(ownerId?: string) {
    const metrics = emptyMetrics();
    for (const sample of this.samples.filter((item) =>
      ownerId === undefined || item.ownerId === ownerId)) {
      (metrics.endpointUsage as Record<string, number>)[sample.endpoint] =
        (metrics.endpointUsage[sample.endpoint] ?? 0) + 1;
      (metrics.serviceDistribution as Record<string, number>)[sample.service] =
        (metrics.serviceDistribution[sample.service] ?? 0) + 1;
      (metrics as { totalLatencyMs: number }).totalLatencyMs += sample.latencyMs;
      if (sample.cacheHit) (metrics as { cacheHits: number }).cacheHits += 1;
      if (sample.failed) (metrics as { failures: number }).failures += 1;
    }
    return clone(metrics);
  }

  async recover() {
    let removed = 0;
    for (const [key, value] of this.cache) {
      if (value.schemaVersion === REPOSITORY_API_GATEWAY_SCHEMA_VERSION) continue;
      this.cache.delete(key);
      removed += 1;
    }
    return removed;
  }

  async verify() {}
}

type RpcClient = Pick<SupabaseClient, "rpc">;
const first = (value: unknown) => Array.isArray(value) ? value[0] : value;

export class PostgresRepositoryApiGatewayStore
implements RepositoryApiGatewayStore {
  constructor(private readonly database: RpcClient =
    supabase as unknown as SupabaseClient) {}

  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositoryGatewayError(
      "gateway_dependency_unavailable",
      "Repository API Gateway persistence is unavailable.",
      503,
      { operation: name },
    );
    return first(data);
  }

  async get(cacheKey: string, ownershipFingerprint: string) {
    const value = await this.call("get_repository_api_gateway_cache", {
      input_cache_key: cacheKey,
      input_ownership_fingerprint: ownershipFingerprint,
    });
    return value ? clone(value as RepositoryGatewayCacheRecord) : null;
  }

  async put(record: RepositoryGatewayCacheRecord) {
    return clone(await this.call("put_repository_api_gateway_cache", {
      input_record: record,
    }) as RepositoryGatewayCacheRecord);
  }

  async record(sample: RepositoryGatewayMetricSample) {
    await this.call("record_repository_api_gateway_metric", {
      input_sample: sample,
    });
  }

  async metrics(ownerId?: string) {
    return clone(await this.call("repository_api_gateway_metrics", {
      input_owner_id: ownerId ?? null,
    }) as RepositoryGatewayMetrics);
  }

  async recover() {
    return Number(await this.call("recover_repository_api_gateway_cache") ?? 0);
  }

  async verify() {
    const result = await this.call(
      "verify_repository_api_gateway_contract") as {
        valid?: boolean;
        schemaVersion?: string;
      };
    if (!result?.valid ||
        result.schemaVersion !== REPOSITORY_API_GATEWAY_SCHEMA_VERSION) {
      throw new RepositoryGatewayError(
        "gateway_dependency_unavailable",
        "Repository API Gateway schema or indexes are invalid.",
        503,
      );
    }
  }
}

export const runtimeRepositoryApiGatewayStore: RepositoryApiGatewayStore =
  env.NODE_ENV === "test"
    ? new MemoryRepositoryApiGatewayStore()
    : new PostgresRepositoryApiGatewayStore();
