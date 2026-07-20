import {
  createShutdownCoordinator,
  type ShutdownCoordinator,
  type ShutdownLogger,
  type ShutdownResult,
  type ShutdownSignal,
} from "./shutdownCoordinator.js";

export interface BackendShutdownOptions {
  logger: ShutdownLogger;
  timeoutMs: number;
  stopAcceptingRequests: () => void | Promise<void>;
  stopIndexingWorkers: (signal: ShutdownSignal) => void | Promise<void>;
  closeDatabase: () => void | Promise<void>;
  flushLogs: () => void | Promise<void>;
  forceStop?: () => void | Promise<void>;
  setTimer?: (callback: () => void, timeoutMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createBackendShutdown(options: BackendShutdownOptions): ShutdownCoordinator {
  let signal: ShutdownSignal = "SIGTERM";
  const coordinator = createShutdownCoordinator({
    logger: options.logger,
    timeoutMs: options.timeoutMs,
    stopAcceptingRequests: options.stopAcceptingRequests,
    cleanupTasks: [
      {
        name: "indexing_workers",
        run: () => options.stopIndexingWorkers(signal),
      },
      {
        name: "database_connections",
        run: options.closeDatabase,
      },
    ],
    flushLogs: options.flushLogs,
    forceStop: options.forceStop,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });

  return {
    ...coordinator,
    requestShutdown(requestedSignal) {
      if (!coordinator.isShuttingDown()) signal = requestedSignal;
      return coordinator.requestShutdown(requestedSignal);
    },
  };
}

export interface ShutdownSignalHandlerOptions {
  coordinator: ShutdownCoordinator;
  subscribe: (signal: ShutdownSignal, handler: () => void) => () => void;
  setExitCode: (code: 0 | 1) => void;
  forceExit: (code: 1) => void;
  onResult?: (result: ShutdownResult) => void;
}

export function installShutdownSignalHandlers(
  options: ShutdownSignalHandlerOptions,
): () => void {
  let resultApplied = false;
  const applyResult = (result: ShutdownResult) => {
    if (resultApplied) return;
    resultApplied = true;
    options.setExitCode(result.exitCode);
    options.onResult?.(result);
    if (result.outcome === "timeout" || result.outcome === "forced") {
      options.forceExit(1);
    }
  };
  const handle = (signal: ShutdownSignal) => {
    void options.coordinator.requestShutdown(signal).then(applyResult);
  };
  const unsubscribe = [
    options.subscribe("SIGINT", () => handle("SIGINT")),
    options.subscribe("SIGTERM", () => handle("SIGTERM")),
  ];
  return () => unsubscribe.forEach((remove) => remove());
}
