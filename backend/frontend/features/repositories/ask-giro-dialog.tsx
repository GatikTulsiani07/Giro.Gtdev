"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Radio } from "@/components/ui/form-controls";
import { Modal } from "@/components/ui/overlays";
import { useCreateSession, useSessions } from "@/hooks/use-sessions";
import type { RepositoryExplorerItem, RepositoryExplorerTab } from "@/lib/repository-explorer";
import type { RetrievalResult } from "@/types/api";

export type AskGiroTarget =
  | {
      kind: "repository-item";
      item: RepositoryExplorerItem;
      location:
        | { kind: "explorer"; tab: RepositoryExplorerTab }
        | { kind: "search"; query: string; resultKey: string };
    }
  | {
      kind: "indexed-evidence";
      result: RetrievalResult;
      query: string;
      resultKey: string;
    };

export function AskGiroDialog({
  open,
  owner,
  repo,
  target,
  onClose,
}: {
  open: boolean;
  owner: string;
  repo: string;
  target: AskGiroTarget;
  onClose(): void;
}) {
  const router = useRouter();
  const sessions = useSessions();
  const create = useCreateSession();
  const [choice, setChoice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => () => {
    openRef.current = false;
  }, []);
  const repositorySessions =
    sessions.data?.sessions.filter((session) => session.owner === owner && session.repo === repo) ?? [];

  async function continueToSession() {
    if (!choice || inFlight.current || create.isPending) return;
    inFlight.current = true;

    if (choice.startsWith("session:")) {
      const sessionId = choice.slice("session:".length);
      const session = repositorySessions.find((candidate) => candidate.id === sessionId);
      if (!session) {
        inFlight.current = false;
        return;
      }
      if (openRef.current) router.push(chatHandoffUrl(session.id, target));
      return;
    }

    try {
      const session = await create.mutateAsync({
        owner,
        repo,
        title: askGiroSessionTitle(target),
      });
      if (openRef.current) router.push(chatHandoffUrl(session.id, target));
    } catch {
      inFlight.current = false;
    }
  }

  return (
    <Modal
      open={open}
      title="Ask Giro about this"
      description={`Choose a session for ${owner}/${repo}. Nothing will be submitted yet.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void continueToSession()} disabled={!choice || create.isPending}>
            {create.isPending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            {create.isPending ? "Creating…" : "Continue"}
          </Button>
        </>
      }
    >
      <fieldset disabled={create.isPending}>
        <legend className="type-compact-strong">Continue in</legend>
        {sessions.isLoading ? <p role="status" aria-live="polite" className="mt-3 type-compact text-muted-foreground">Loading repository sessions…</p> : null}
        {sessions.isError ? <div className="mt-3"><ErrorState error={sessions.error} retry={() => void sessions.refetch()} compact /></div> : null}
        {!sessions.isLoading && !sessions.isError ? (
          <div className="mt-3 divide-y divide-border-subtle border-y border-border-subtle">
            {repositorySessions.map((session) => (
              <Radio
                key={session.id}
                name="ask-giro-session"
                value={`session:${session.id}`}
                checked={choice === `session:${session.id}`}
                onChange={(event) => setChoice(event.currentTarget.value)}
                label={session.title}
                description={`${session.messageCount} messages`}
                className="px-3 py-2"
              />
            ))}
            {repositorySessions.length === 0 ? <p className="px-3 py-3 type-compact text-muted-foreground">No sessions exist for this repository.</p> : null}
            <Radio
              name="ask-giro-session"
              value="new"
              checked={choice === "new"}
              onChange={(event) => setChoice(event.currentTarget.value)}
              label="New session"
              description="Create an empty repository-scoped session."
              className="px-3 py-2"
            />
          </div>
        ) : null}
      </fieldset>
      {create.isPending ? <p role="status" aria-live="polite" className="mt-3 type-compact text-muted-foreground">Creating repository session…</p> : null}
      {create.isError ? <div className="mt-3"><ErrorState error={create.error} compact /></div> : null}
    </Modal>
  );
}

export function askGiroSessionTitle(target: AskGiroTarget): string {
  if (target.kind === "repository-item") return target.item.name;
  return target.result.symbol ?? target.result.filePath;
}

export function chatHandoffUrl(sessionId: string, target: AskGiroTarget): string {
  const params = new URLSearchParams();
  if (target.kind === "repository-item") {
    if (target.location.kind === "explorer") {
      params.set("source", "repository-explorer");
      params.set("tab", target.location.tab);
      params.set("category", target.item.category);
      params.set("item", target.item.key);
    } else {
      params.set("source", "repository-search");
      params.set("q", target.location.query);
      params.set("result", target.location.resultKey);
    }
  } else {
    params.set("source", "repository-search");
    params.set("q", target.query);
    params.set("result", target.resultKey);
  }
  return `/chat/${encodeURIComponent(sessionId)}?${params.toString()}`;
}
