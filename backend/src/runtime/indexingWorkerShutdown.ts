import type { ShutdownSignal } from "./shutdownCoordinator.js";

export interface IndexingWorkerShutdownHook {
  stop(signal: ShutdownSignal): void | Promise<void>;
}

const hooks = new Set<IndexingWorkerShutdownHook>();

export function registerIndexingWorkerShutdownHook(
  hook: IndexingWorkerShutdownHook,
): () => void {
  hooks.add(hook);
  return () => hooks.delete(hook);
}

export async function stopRegisteredIndexingWorkers(signal: ShutdownSignal): Promise<void> {
  await Promise.all([...hooks].map((hook) => hook.stop(signal)));
}
