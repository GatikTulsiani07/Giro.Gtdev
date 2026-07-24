import { stableHash } from "../repositoryExecution/determinism.js";
import type {
  AgentCapability,
  AgentKind,
  AgentLimits,
  RegisteredAgent,
} from "./types.js";
import { AgentRuntimeError } from "./types.js";

const ALLOWED = Object.freeze([
  "reasoning",
  "retrieval",
  "repository_graph",
  "repository_intelligence",
  "repository_planning",
] as const);
const FORBIDDEN = Object.freeze([
  "shell",
  "filesystem_mutation",
  "git",
  "network",
  "secrets",
  "process_execution",
] as const);
const LIMITS: AgentLimits = Object.freeze({
  runtimeDurationMs: 120_000,
  retries: 2,
  outputBytes: 1_048_576,
  concurrentWorkUnits: 1,
});

const definitions: ReadonlyArray<{
  id: AgentKind;
  name: string;
  work: readonly string[];
  languages: readonly string[];
}> = [
  { id: "planner", name: "Planner", work: ["planning", "decomposition"], languages: ["all"] },
  { id: "backend-engineer", name: "Backend Engineer", work: ["backend planning"], languages: ["typescript", "javascript", "python", "go", "rust", "java"] },
  { id: "frontend-engineer", name: "Frontend Engineer", work: ["frontend planning"], languages: ["typescript", "javascript", "html", "css"] },
  { id: "devops", name: "DevOps", work: ["operations planning", "deployment review"], languages: ["yaml", "shell", "hcl"] },
  { id: "reviewer", name: "Reviewer", work: ["review", "risk analysis"], languages: ["all"] },
  { id: "documentation", name: "Documentation", work: ["documentation planning"], languages: ["markdown", "all"] },
  { id: "test-engineer", name: "Test Engineer", work: ["test planning", "validation planning"], languages: ["all"] },
  { id: "refactoring", name: "Refactoring", work: ["refactoring planning"], languages: ["all"] },
  { id: "security", name: "Security", work: ["security review", "threat analysis"], languages: ["all"] },
  { id: "architecture", name: "Architecture", work: ["architecture review", "dependency planning"], languages: ["all"] },
];

function capability(agentId: AgentKind): AgentCapability {
  const capabilityVersion = `${agentId}-capability-v1`;
  const declaration = {
    capabilityVersion,
    deterministic: true as const,
    allowed: ALLOWED,
    forbidden: FORBIDDEN,
  };
  return Object.freeze({
    ...declaration,
    capabilityHash: stableHash(declaration),
  });
}

export class AgentCapabilityRegistry {
  private readonly agents = new Map<AgentKind, RegisteredAgent>();

  constructor(entries = definitions) {
    for (const entry of entries) {
      const registered: RegisteredAgent = Object.freeze({
        agentId: entry.id,
        name: entry.name,
        version: `${entry.id}-v1`,
        capability: capability(entry.id),
        supportedWork: Object.freeze([...entry.work]),
        supportedRepositories: Object.freeze(["published:*"]),
        supportedLanguages: Object.freeze([...entry.languages]),
        limits: LIMITS,
      });
      if (this.agents.has(entry.id)) {
        throw new AgentRuntimeError("duplicate_agent", `Agent ${entry.id} is already registered.`);
      }
      this.agents.set(entry.id, registered);
    }
    this.verify();
  }

  list(): readonly RegisteredAgent[] {
    return Object.freeze([...this.agents.values()]);
  }

  get(agentId: AgentKind): RegisteredAgent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new AgentRuntimeError("invalid_capability", `Agent ${agentId} is not registered.`);
    return agent;
  }

  verify(): void {
    if (this.agents.size !== definitions.length) {
      throw new AgentRuntimeError("invalid_capability", "Capability registry is incomplete.");
    }
    for (const agent of this.agents.values()) {
      const { capabilityHash: _hash, ...declaration } = agent.capability;
      if (!agent.capability.deterministic ||
          stableHash(declaration) !== agent.capability.capabilityHash ||
          FORBIDDEN.some((operation) => !agent.capability.forbidden.includes(operation)) ||
          agent.capability.allowed.some((operation) =>
            (agent.capability.forbidden as readonly string[]).includes(operation))) {
        throw new AgentRuntimeError("invalid_capability", `Capability ${agent.capability.capabilityVersion} is invalid.`);
      }
    }
  }
}

export const runtimeAgentCapabilityRegistry = new AgentCapabilityRegistry();
