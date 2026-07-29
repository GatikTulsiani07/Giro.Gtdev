import { runtimeMetrics } from "../../observability/metrics.js";
import type { RepositorySandboxStore } from "./store.js";
import { runtimeRepositorySandboxStore } from "./store.js";
import type {
  CreateSandboxInput,
  SandboxClaim,
  SandboxQuotas,
} from "./types.js";

export const DEFAULT_SANDBOX_QUOTAS: SandboxQuotas = Object.freeze({
  activePerOwner: 16,
  activeLeasesPerOwner: 8,
  leaseMs: 60_000,
  preparationTimeoutMs: 5 * 60_000,
  retainedSandboxes: 100,
  retainedRecoveryRecords: 100,
});

export class RepositorySandboxService {
  constructor(
    private readonly store: RepositorySandboxStore = runtimeRepositorySandboxStore,
    private readonly quotas: SandboxQuotas = DEFAULT_SANDBOX_QUOTAS,
  ) {}

  async create(input: CreateSandboxInput) {
    const sandbox = await this.store.create(input, this.quotas);
    await this.recordMetrics();
    return sandbox;
  }

  get(tenantId: string, ownerId: string, repositoryId: string, sandboxId: string) {
    return this.store.get(tenantId, ownerId, repositoryId, sandboxId);
  }

  async prepare(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
  ) {
    const sandbox = await this.store.prepare(
      tenantId, ownerId, repositoryId, sandboxId,
    );
    await this.recordMetrics();
    return sandbox;
  }

  failPreparation(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    reason: string,
  ) {
    return this.store.failPreparation(
      tenantId, ownerId, repositoryId, sandboxId, reason,
    );
  }

  async acquire(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
    leaseOwner: string,
  ) {
    const claim = await this.store.acquire(
      tenantId, ownerId, repositoryId, sandboxId,
      leaseOwner, this.quotas.leaseMs, this.quotas,
    );
    await this.recordMetrics();
    return claim;
  }

  async renew(claim: SandboxClaim) {
    const renewed = await this.store.renew(claim, this.quotas.leaseMs);
    await this.recordMetrics();
    return renewed;
  }

  async release(claim: SandboxClaim) {
    const sandbox = await this.store.release(claim);
    await this.recordMetrics();
    return sandbox;
  }

  async archive(
    tenantId: string, ownerId: string, repositoryId: string, sandboxId: string,
  ) {
    const sandbox = await this.store.archive(
      tenantId, ownerId, repositoryId, sandboxId,
    );
    await this.recordMetrics();
    return sandbox;
  }

  async recover() {
    const count = await this.store.recover(undefined, this.quotas);
    await this.recordMetrics();
    return count;
  }

  collect(tenantId: string) {
    return this.store.collect(tenantId, this.quotas);
  }

  metrics(tenantId?: string) {
    return this.store.metrics(tenantId);
  }

  verify() {
    return this.store.verify();
  }

  private async recordMetrics(): Promise<void> {
    runtimeMetrics.recordRepositorySandbox(await this.store.metrics());
  }
}

export const runtimeRepositorySandboxService = new RepositorySandboxService();
