import type { SessionListCursor } from "./types.js";

export function encodeSessionCursor(cursor: SessionListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeSessionCursor(value: string): SessionListCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_session_cursor");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("invalid_session_cursor");
  const cursor = parsed as Record<string, unknown>;
  if (
    typeof cursor.updatedAt !== "string" || !Number.isFinite(Date.parse(cursor.updatedAt)) ||
    typeof cursor.sessionId !== "string" || cursor.sessionId.length < 1 || cursor.sessionId.length > 200
  ) throw new Error("invalid_session_cursor");
  return { updatedAt: cursor.updatedAt, sessionId: cursor.sessionId };
}
