import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import { supabase } from "../../lib/supabase.js";
import {
  RepositoryEvolutionError, type EvolutionAuxiliarySources,
  type EvolutionRevisionSources,
} from "./types.js";
import { cloneEvolution } from "./validation.js";

export interface RepositoryEvolutionSourceReader {
  load(
    tenantId: string, ownerId: string, repositoryId: string,
    baseRevision: string, targetRevision: string,
  ): Promise<EvolutionAuxiliarySources>;
  loadRevision?(
    tenantId: string, ownerId: string, repositoryId: string,
    repositoryRevision: string,
  ): Promise<EvolutionRevisionSources | null>;
  verify(): Promise<void>;
}

export class MemoryRepositoryEvolutionSourceReader
implements RepositoryEvolutionSourceReader {
  constructor(private readonly sources: EvolutionAuxiliarySources = {
    baseWorkflows: [], targetWorkflows: [],
    baseKnowledge: [], targetKnowledge: [],
  }) {}
  async load() { return cloneEvolution(this.sources); }
  async verify() {}
}

type Database = Pick<SupabaseClient, "rpc">;
const first = (value: unknown) => Array.isArray(value) ? value[0] : value;

export class PostgresRepositoryEvolutionSourceReader
implements RepositoryEvolutionSourceReader {
  constructor(private readonly database: Database) {}
  private async call(name: string, parameters: Record<string, unknown> = {}) {
    const { data, error } = await this.database.rpc(name, parameters);
    if (error) throw new RepositoryEvolutionError(
      "repository_evolution_source_unavailable",
      error.message ?? "Repository evolution sources are unavailable.");
    return first(data);
  }
  async load(
    tenantId: string, ownerId: string, repositoryId: string,
    baseRevision: string, targetRevision: string,
  ) {
    const data = await this.call("get_repository_evolution_auxiliary_sources", {
      input_tenant_id: tenantId, input_owner_id: ownerId,
      input_repository_id: repositoryId,
      input_base_revision: baseRevision,
      input_target_revision: targetRevision,
    }) as unknown;
    const sources = typeof data === "object" && data !== null &&
      "sources" in data
      ? (data as { sources: EvolutionAuxiliarySources }).sources
      : data as EvolutionAuxiliarySources;
    if (!sources) throw new RepositoryEvolutionError(
      "repository_evolution_source_unavailable",
      "Repository evolution source ownership or lineage was rejected.");
    return cloneEvolution(sources);
  }
  async loadRevision(
    tenantId: string, ownerId: string, repositoryId: string,
    repositoryRevision: string,
  ) {
    const data = await this.call("get_repository_evolution_revision_source", {
      input_tenant_id: tenantId, input_owner_id: ownerId,
      input_repository_id: repositoryId,
      input_repository_revision: repositoryRevision,
    }) as unknown;
    if (!data) return null;
    const source = typeof data === "object" && data !== null &&
      "revision_source" in data
      ? (data as { revision_source: EvolutionRevisionSources }).revision_source
      : data as EvolutionRevisionSources;
    return cloneEvolution(source);
  }
  async verify() {
    const result = await this.call(
      "verify_repository_evolution_source_contract") as
      { valid?: boolean; problems?: unknown };
    if (result.valid !== true) throw new RepositoryEvolutionError(
      "repository_evolution_source_unavailable",
      `Repository evolution source contract is invalid: ${
        JSON.stringify(result.problems ?? [])
      }`);
  }
}

export const runtimeRepositoryEvolutionSourceReader:
RepositoryEvolutionSourceReader = env.NODE_ENV === "test"
  ? new MemoryRepositoryEvolutionSourceReader()
  : new PostgresRepositoryEvolutionSourceReader(
    supabase as unknown as SupabaseClient);
