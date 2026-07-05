import { beforeEach, describe, expect, it } from "vitest";

import {
  clearRepositoryLifecycleEvents,
  listRepositoryLifecycleEvents,
  recordRepositoryLifecycleEvent,
} from "../services/repository/repositoryLifecycleEvents.js";

beforeEach(() => {
  clearRepositoryLifecycleEvents();
});

describe("repository lifecycle events", () => {
  it("creates deterministic lifecycle events without timestamps", () => {
    const event = recordRepositoryLifecycleEvent({
      repositoryId: "acme/demo",
      type: "repository_cleanup_planned",
      message: "Repository cleanup plan built.",
      metadata: {
        totalResources: 2,
        cleanupRequired: true,
        resources: ["symbols", "metadata"],
      },
    });

    expect(event).toEqual({
      repositoryId: "acme/demo",
      sequence: 1,
      type: "repository_cleanup_planned",
      message: "Repository cleanup plan built.",
      metadata: {
        cleanupRequired: true,
        resources: ["metadata", "symbols"],
        totalResources: 2,
      },
    });
    expect(Object.keys(event)).toEqual([
      "repositoryId",
      "sequence",
      "type",
      "message",
      "metadata",
    ]);
    expect("timestamp" in event).toBe(false);
    expect("time" in event).toBe(false);
  });

  it("lists events in stable sequence order", () => {
    recordRepositoryLifecycleEvent({
      repositoryId: "beta/api",
      type: "repository_dashboard_viewed",
      message: "Repository dashboard summary viewed.",
    });
    recordRepositoryLifecycleEvent({
      repositoryId: "acme/demo",
      type: "repository_cleanup_planned",
      message: "Repository cleanup plan built.",
    });
    recordRepositoryLifecycleEvent({
      repositoryId: "acme/demo",
      type: "repository_cleanup_executed",
      message: "Repository cleanup plan executed.",
    });

    expect(listRepositoryLifecycleEvents().map((event) => event.sequence)).toEqual([
      1,
      2,
      3,
    ]);
    expect(
      listRepositoryLifecycleEvents("acme/demo").map((event) => event.type),
    ).toEqual([
      "repository_cleanup_planned",
      "repository_cleanup_executed",
    ]);
  });

  it("returns copies so callers cannot mutate the event store", () => {
    const event = recordRepositoryLifecycleEvent({
      repositoryId: "acme/demo",
      type: "repository_cleanup_reported",
      message: "Repository cleanup report built.",
      metadata: {
        resources: ["metadata"],
      },
    });
    event.metadata.resources = ["mutated"];

    const listed = listRepositoryLifecycleEvents();
    listed[0]!.metadata.resources = ["mutated-again"];

    expect(listRepositoryLifecycleEvents()).toEqual([
      {
        repositoryId: "acme/demo",
        sequence: 1,
        type: "repository_cleanup_reported",
        message: "Repository cleanup report built.",
        metadata: {
          resources: ["metadata"],
        },
      },
    ]);
  });

  it("clear helper resets event store and sequence", () => {
    recordRepositoryLifecycleEvent({
      repositoryId: "acme/demo",
      type: "repository_dashboard_viewed",
      message: "Repository dashboard summary viewed.",
    });

    clearRepositoryLifecycleEvents();

    expect(listRepositoryLifecycleEvents()).toEqual([]);
    expect(
      recordRepositoryLifecycleEvent({
        repositoryId: "acme/demo",
        type: "repository_dashboard_viewed",
        message: "Repository dashboard summary viewed.",
      }).sequence,
    ).toBe(1);
  });
});
