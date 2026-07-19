import type { Message, Session } from "../types.js";

export interface SessionRow {
  session_id: string;
  owner_user_id: string;
  repository_id: string;
  repository_owner: string;
  repository_name: string;
  title: string;
  selected_context: Session["selectedContext"];
  created_at: string;
  updated_at: string;
}

export interface SessionMessageRow {
  message_id: string;
  session_id: string;
  role: Message["role"];
  content: string;
  citations: Message["citations"];
  evidence: Message["evidence"] | null;
  retrieval_metadata: Message["retrievalMetadata"] | null;
  created_at: string;
  message_order?: number;
}

export function sessionToRow(session: Session): SessionRow {
  return {
    session_id: session.id,
    owner_user_id: session.userId,
    repository_id: `${session.owner}/${session.repo}`,
    repository_owner: session.owner,
    repository_name: session.repo,
    title: session.title,
    selected_context: session.selectedContext,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

export function messageToRow(sessionId: string, message: Message): SessionMessageRow {
  return {
    message_id: message.id,
    session_id: sessionId,
    role: message.role,
    content: message.content,
    citations: message.citations,
    evidence: message.evidence ?? null,
    retrieval_metadata: message.retrievalMetadata ?? null,
    created_at: message.createdAt,
  };
}

export function messageFromRow(row: SessionMessageRow): Message {
  return {
    id: row.message_id,
    role: row.role,
    content: row.content,
    citations: row.citations ?? [],
    ...(row.evidence ? { evidence: row.evidence } : {}),
    ...(row.retrieval_metadata ? { retrievalMetadata: row.retrieval_metadata } : {}),
    createdAt: row.created_at,
  };
}

export function sessionFromRow(row: SessionRow, messages: Message[]): Session {
  return {
    id: row.session_id,
    userId: row.owner_user_id,
    owner: row.repository_owner,
    repo: row.repository_name,
    title: row.title,
    selectedContext: row.selected_context ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
  };
}
