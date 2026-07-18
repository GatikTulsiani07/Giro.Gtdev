"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/overlays";
import { ErrorState } from "@/components/ui/error-state";
import type { SessionSummary } from "@/types/api";

export function ConversationHistory({ sessions, activeId, onCreate, creating, createError, onDelete, deleting = false }: { sessions: SessionSummary[]; activeId: string; onCreate(): void; creating: boolean; createError?: unknown; onDelete?(id: string): void; deleting?: boolean }) {
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border-subtle bg-panel" aria-label="Conversation history">
      <div className="border-b border-border-subtle p-3"><Button variant="secondary" className="w-full justify-start" size="sm" onClick={onCreate} disabled={creating}><Plus className="size-3.5" />New session</Button>{createError ? <div className="mt-2"><ErrorState error={createError} compact /></div> : null}</div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2"><p className="px-2 pb-2 pt-1 type-metadata-label text-muted-foreground">Repository sessions</p><div className="space-y-1">{sessions.map((session) => <div key={session.id} className={`group relative flex min-h-10 items-center rounded-control ${session.id === activeId ? "bg-selection before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:bg-primary" : "hover:bg-hover"}`}><Link href={`/chat/${session.id}`} className="flex min-w-0 flex-1 items-start gap-2 rounded-control p-2.5 type-compact text-text-secondary focus-ring"><MessageSquare className={`mt-0.5 size-3.5 shrink-0 ${session.id === activeId ? "text-primary" : ""}`} /><span className="min-w-0"><span className="block truncate type-compact-strong text-foreground">{session.title}</span><span className="mt-1 block type-metadata text-muted-foreground">{session.messageCount} messages</span></span></Link>{onDelete ? <Button variant="ghost" size="icon-sm" className="mr-1 shrink-0" aria-label={`Delete ${session.title}`} onClick={() => setDeleteTarget(session)} disabled={deleting}><Trash2 className="size-3" /></Button> : null}</div>)}</div>{sessions.length === 0 ? <p className="px-2 py-4 type-compact text-muted-foreground">No sessions in this repository.</p> : null}</div>
      <ConfirmationDialog open={Boolean(deleteTarget)} title="Delete session" objectName={deleteTarget?.title ?? "this session"} onCancel={() => setDeleteTarget(null)} onConfirm={() => { if (deleteTarget) onDelete?.(deleteTarget.id); setDeleteTarget(null); }}>The session and its conversation history will be removed.</ConfirmationDialog>
    </aside>
  );
}
