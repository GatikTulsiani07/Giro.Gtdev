import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export const TRACEPARENT_HEADER = "traceparent";

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: string;
  readonly parentSpanId?: string;
}

export interface TraceIdGenerators {
  generateTraceId?: () => string;
  generateSpanId?: () => string;
}

const traceContextStorage = new AsyncLocalStorage<TraceContext>();

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function isValidTraceId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value) && value.toLowerCase() !== ZERO_TRACE_ID;
}

export function isValidSpanId(value: string): boolean {
  return /^[0-9a-f]{16}$/i.test(value) && value.toLowerCase() !== ZERO_SPAN_ID;
}

export function parseTraceparent(value: string | undefined): TraceContext | null {
  if (!value) return null;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (!match || !isValidTraceId(match[1]!) || !isValidSpanId(match[2]!)) return null;
  return Object.freeze({
    traceId: match[1]!.toLowerCase(),
    spanId: match[2]!.toLowerCase(),
    traceFlags: match[3]!.toLowerCase(),
  });
}

export function createTraceContext(
  parent: TraceContext | null = null,
  generators: TraceIdGenerators = {},
): TraceContext {
  const generateTraceId = generators.generateTraceId ?? (() => randomHex(16));
  const generateSpanId = generators.generateSpanId ?? (() => randomHex(8));
  const traceId = parent?.traceId ?? generateTraceId().toLowerCase();
  const spanId = generateSpanId().toLowerCase();
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) {
    throw new Error("Trace ID generators returned invalid identifiers.");
  }
  return Object.freeze({
    traceId,
    spanId,
    traceFlags: parent?.traceFlags ?? "01",
    ...(parent ? { parentSpanId: parent.spanId } : {}),
  });
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

export function runWithTraceContext<T>(context: TraceContext, callback: () => T): T {
  return traceContextStorage.run(context, callback);
}

export function currentTraceContext(): Readonly<TraceContext> | undefined {
  return traceContextStorage.getStore();
}

export function childTraceContext(
  generators: Pick<TraceIdGenerators, "generateSpanId"> = {},
): TraceContext {
  return createTraceContext(currentTraceContext() ?? null, generators);
}

export function runWithChildSpan<T>(
  callback: () => T,
  generators: Pick<TraceIdGenerators, "generateSpanId"> = {},
): T {
  return runWithTraceContext(childTraceContext(generators), callback);
}
