import { listAllSessions, removeSession } from "./sessionService.js";

export interface SessionCleanupCandidate {
  sessionId: string;
  reason: string;
}

const MAX_MESSAGES = 100;

export function findSessionCleanupCandidates(): SessionCleanupCandidate[] {
  return listAllSessions()
    .filter((session) => session.messageCount > MAX_MESSAGES)
    .map((session) => ({
      sessionId: session.id,
      reason: "SESSION_TOO_LARGE",
    }));
}

export function cleanupSessions(): number {
  const candidates = findSessionCleanupCandidates();

  for (const candidate of candidates) {
    removeSession(candidate.sessionId);
  }

  return candidates.length;
}