export type RepositoryLifecycleEventType =
  | "repository_connected"
  | "repository_indexed"
  | "repository_dashboard_viewed"
  | "repository_cleanup_planned"
  | "repository_cleanup_executed"
  | "repository_cleanup_reported"
  | "repository_cleanup_failed";

export type RepositoryLifecycleEventMetadataValue =
  | string
  | number
  | boolean
  | null
  | string[];

export type RepositoryLifecycleEventMetadata = Record<
  string,
  RepositoryLifecycleEventMetadataValue
>;

export interface RepositoryLifecycleEvent {
  repositoryId: string;
  sequence: number;
  type: RepositoryLifecycleEventType;
  message: string;
  metadata: RepositoryLifecycleEventMetadata;
}

export interface RecordRepositoryLifecycleEventInput {
  repositoryId: string;
  type: RepositoryLifecycleEventType;
  message: string;
  metadata?: RepositoryLifecycleEventMetadata;
}

const events: RepositoryLifecycleEvent[] = [];
let nextSequence = 1;

function copyMetadata(
  metadata: RepositoryLifecycleEventMetadata,
): RepositoryLifecycleEventMetadata {
  return Object.fromEntries(
    Object.entries(metadata)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value].sort((a, b) => a.localeCompare(b)) : value,
      ]),
  );
}

function copyEvent(event: RepositoryLifecycleEvent): RepositoryLifecycleEvent {
  return {
    repositoryId: event.repositoryId,
    sequence: event.sequence,
    type: event.type,
    message: event.message,
    metadata: copyMetadata(event.metadata),
  };
}

export function recordRepositoryLifecycleEvent(
  input: RecordRepositoryLifecycleEventInput,
): RepositoryLifecycleEvent {
  const event: RepositoryLifecycleEvent = {
    repositoryId: input.repositoryId,
    sequence: nextSequence,
    type: input.type,
    message: input.message,
    metadata: copyMetadata(input.metadata ?? {}),
  };

  nextSequence += 1;
  events.push(event);

  return copyEvent(event);
}

export function listRepositoryLifecycleEvents(
  repositoryId?: string,
): RepositoryLifecycleEvent[] {
  return events
    .filter((event) => repositoryId === undefined || event.repositoryId === repositoryId)
    .sort(
      (a, b) =>
        a.sequence - b.sequence ||
        a.repositoryId.localeCompare(b.repositoryId) ||
        a.type.localeCompare(b.type),
    )
    .map(copyEvent);
}

export function clearRepositoryLifecycleEvents(): void {
  events.length = 0;
  nextSequence = 1;
}
