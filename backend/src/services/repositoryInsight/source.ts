import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import type { RepositoryInsightAuxiliarySources } from "./types.js";
import { RepositoryInsightError } from "./types.js";
import { cloneInsight } from "./validation.js";

export interface RepositoryInsightSourceReader {
  load(
    tenantId: string,
    ownerId: string,
    repositoryId: string,
    repositoryRevision: string,
  ): Promise<RepositoryInsightAuxiliarySources>;
  verify(): Promise<void>;
}

export class MemoryRepositoryInsightSourceReader
implements RepositoryInsightSourceReader {
  constructor(
    private readonly sources: RepositoryInsightAuxiliarySources = {
      changeAnalyses: [], workflows: [], knowledge: [], queryHistory: [],
    },
  ) {}
  async load() { return cloneInsight(this.sources); }
  async verify(): Promise<void> {}
}

type Database = Pick<SupabaseClient, "rpc">;
const first = (value: unknown) => Array.isArray(value) ? value[0] : value;

export class PostgresRepositoryInsightSourceReader
implements RepositoryInsightSourceReader {
  constructor(private readonly database: Database) {}
  private async call(name: string, parameters: Record<string, unknown>) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositoryInsightError(
      "repository_insight_source_unavailable",
      error.message ?? "Repository insight source history is unavailable.");
    return first(data);
  }
  async load(
    tenantId: string,
    ownerId: string,
    repositoryId: string,
    repositoryRevision: string,
  ) {
    const data = await this.call("get_repository_insight_auxiliary_sources", {
      input_tenant_id: tenantId,
      input_owner_id: ownerId,
      input_repository_id: repositoryId,
      input_repository_revision: repositoryRevision,
    }) as unknown;
    const sources = typeof data === "object" && data !== null && "sources" in data
      ? (data as { sources: RepositoryInsightAuxiliarySources }).sources
      : data as RepositoryInsightAuxiliarySources;
    return cloneInsight(sources);
  }
  async verify() {
    const result = await this.call(
      "verify_repository_insight_source_contract", {},
    ) as { valid?: boolean; problems?: unknown };
    if (result.valid !== true) {
      throw new RepositoryInsightError(
        "repository_insight_source_unavailable",
        `Repository insight source contract is invalid: ${
          JSON.stringify(result.problems ?? [])
        }`,
      );
    }
  }
}

export const runtimeRepositoryInsightSourceReader: RepositoryInsightSourceReader =
  env.NODE_ENV === "test"
    ? new MemoryRepositoryInsightSourceReader()
    : new PostgresRepositoryInsightSourceReader(
      supabase as unknown as SupabaseClient);
