import { stableHash } from "../repositoryExecution/determinism.js";
import { builtInTools } from "./builtins.js";
import type {
  RegisteredTool,
  ToolDefinition,
  ToolLifecycle,
} from "./types.js";
import { toolFailure, validateToolDefinition } from "./validation.js";

interface MutableRegistration {
  definition: ToolDefinition;
  handler: RegisteredTool["handler"];
}

export class ToolRegistry {
  private readonly tools = new Map<string, Map<string, MutableRegistration>>();

  constructor(entries: readonly RegisteredTool[] = builtInTools()) {
    for (const entry of entries) this.register(entry);
    this.load();
    this.ready();
  }

  register(entry: RegisteredTool): void {
    validateToolDefinition(entry.definition);
    const versions = this.tools.get(entry.definition.toolId) ?? new Map();
    if (versions.has(entry.definition.version)) {
      throw toolFailure("validation", "duplicate_tool_version",
        `Tool ${entry.definition.toolId}@${entry.definition.version} is already registered.`);
    }
    versions.set(entry.definition.version, {
      definition: Object.freeze({ ...entry.definition, lifecycle: "registered" }),
      handler: entry.handler,
    });
    this.tools.set(entry.definition.toolId, versions);
  }

  load(): void {
    for (const versions of this.tools.values()) {
      for (const registration of versions.values()) {
        if (registration.definition.lifecycle === "registered") {
          registration.definition = Object.freeze({ ...registration.definition, lifecycle: "loaded" });
        }
      }
    }
  }

  ready(): void {
    for (const versions of this.tools.values()) {
      for (const registration of versions.values()) {
        if (registration.definition.lifecycle === "loaded") {
          registration.definition = Object.freeze({ ...registration.definition, lifecycle: "ready" });
        }
      }
    }
    this.verify();
  }

  setLifecycle(toolId: string, version: string, lifecycle: ToolLifecycle): void {
    const registration = this.tools.get(toolId)?.get(version);
    if (!registration) throw toolFailure("tool_unavailable", "tool_not_found", "Tool is not registered.");
    registration.definition = Object.freeze({ ...registration.definition, lifecycle });
  }

  get(toolId: string, version: string): RegisteredTool {
    const registration = this.tools.get(toolId)?.get(version);
    if (!registration) throw toolFailure("tool_unavailable", "tool_not_found",
      `Tool ${toolId}@${version} is not registered.`);
    return Object.freeze({ definition: registration.definition, handler: registration.handler });
  }

  resolveReady(toolId: string, version: string): RegisteredTool {
    const tool = this.get(toolId, version);
    if (tool.definition.lifecycle !== "ready") {
      throw toolFailure("tool_unavailable", "tool_not_ready",
        `Tool ${toolId}@${version} is ${tool.definition.lifecycle}.`,
        tool.definition.lifecycle === "failed");
    }
    return tool;
  }

  list(): readonly ToolDefinition[] {
    return Object.freeze([...this.tools.values()]
      .flatMap((versions) => [...versions.values()].map((registration) => registration.definition))
      .sort((left, right) => left.toolId.localeCompare(right.toolId) ||
        left.version.localeCompare(right.version)));
  }

  verify(): void {
    if (this.tools.size === 0) {
      throw toolFailure("validation", "empty_tool_registry", "Tool registry is empty.");
    }
    for (const definition of this.list()) validateToolDefinition(definition);
    const identities = this.list().map(({ toolId, version }) => `${toolId}\0${version}`);
    if (new Set(identities).size !== identities.length) {
      throw toolFailure("validation", "duplicate_tool_version", "Tool registry has duplicate versions.");
    }
  }

  capabilityManifestHash(): string {
    return stableHash(this.list().map(({ lifecycle: _lifecycle, ...definition }) => definition));
  }
}

export const runtimeToolRegistry = new ToolRegistry();
