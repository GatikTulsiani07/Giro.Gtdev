import { getSessionById } from "./sessionService.js";

export type SessionAccessResult =
  | { ok: true }
  | {
      ok: false;
      status: 403 | 404;
      code: string;
      message: string;
    };

export function requireSessionAccess({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}): SessionAccessResult {
  const session = getSessionById(sessionId);

  if (!session) {
    return {
      ok: false,
      status: 404,
      code: "session_not_found",
      message: "Session not found",
    };
  }

  if (session.userId !== userId) {
    return {
      ok: false,
      status: 403,
      code: "session_not_owned",
      message: "Session does not belong to authenticated user",
    };
  }

  return { ok: true };
}