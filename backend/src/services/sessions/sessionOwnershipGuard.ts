import { getSessionByIdForOwner, getSessionSummaryById } from "./sessionService.js";
import { flatMapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";
import type { Session } from "./types.js";

export type SessionAccessResult =
  | { ok: true; session: Session }
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
}): SessionAccessResult;
export function requireSessionAccess({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}): MaybePromise<SessionAccessResult> {
  return flatMapMaybePromise(getSessionSummaryById(sessionId), (summary) => {
    if (!summary) {
      return {
        ok: false,
        status: 404,
        code: "session_not_found",
        message: "Session not found",
      };
    }

    if (summary.userId !== userId) {
      return {
        ok: false,
        status: 403,
        code: "session_not_owned",
        message: "Session does not belong to authenticated user",
      };
    }

    return flatMapMaybePromise(getSessionByIdForOwner(sessionId, userId), (session) =>
      session
        ? { ok: true as const, session }
        : { ok: false as const, status: 404 as const, code: "session_not_found", message: "Session not found" });
  });
}
