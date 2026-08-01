"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Panel, PanelGroup } from "react-resizable-panels";
import {
  AlertTriangle,
  Braces,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  GitBranch,
  Info,
  ListTree,
  Menu,
  MessageSquare,
  Pin,
  Play,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyControl } from "@/components/ui/copy-control";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ResizableHandle } from "@/components/ui/resizable-handle";
import { Skeleton } from "@/components/ui/skeleton";
import { RepositoryStatusBadge } from "@/components/ui/status-badge";
import { SegmentedControl } from "@/components/ui/tabs";
import {
  useArchiveEngineeringSession,
  useAttachWorkflow,
  useCreateEngineeringSession,
  useDeleteEngineeringSession,
  useEngineeringAction,
  useEngineeringSession,
  useEngineeringSessions,
} from "@/hooks/use-engineering-sessions";
import {
  repositoryGatewayGuard,
  useFeatureNavigation,
  useGatewayOverview,
  useRepositoryDirectory,
  useRepositoryFile,
  useSemanticNavigation,
} from "@/hooks/use-repository-workspace";
import { MarkdownMessage } from "@/features/chat/markdown-message";
import { cn } from "@/lib/utils";
import type {
  DirectoryEntry,
  FeatureNavigationOperation,
  FileReadResult,
  JsonRecord,
  JsonValue,
  NormalizedDiagnostic,
  RepositoryGatewayOverview,
  RepositoryMetadata,
  RepositorySessionDetail,
  RepositorySessionEvent,
  RepositorySessionSummary,
  SemanticNavigationOperation,
} from "@/types/api";

const VIEWS = ["overview", "architecture", "features", "symbols"] as const;
type WorkspaceView = (typeof VIEWS)[number];
type Evidence = {
  title: string;
  kind: "Files" | "Symbols" | "Relationships" | "Features" | "Diagnostics" | "Metadata";
  value: JsonValue | NormalizedDiagnostic[] | undefined;
  requestId?: string;
  confidence?: JsonValue;
};

const VIEW_TABS = VIEWS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), panelId: `repository-${id}-workspace` }));
const FEATURE_OPERATIONS: FeatureNavigationOperation[] = ["feature", "entry-points", "exit-points", "files", "symbols", "dependencies", "upstream", "downstream"];
const SEMANTIC_OPERATIONS: SemanticNavigationOperation[] = ["definition", "references", "implementations", "callers", "callees", "inheritance", "dependencies"];

export function RepositoryWorkspace({ owner, repo, metadata }: { owner: string; repo: string; metadata: RepositoryMetadata }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const desktop = useDesktopLayout();
  const [mobilePane, setMobilePane] = useState<"context" | "workspace" | "evidence">("workspace");
  const [leftOpen, setLeftOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const liveRegionRef = useRef<HTMLDivElement>(null);
  const guard = repositoryGatewayGuard(metadata);
  const view = parseView(searchParams.get("view"));
  const selectedFile = searchParams.get("file") ?? "";
  const selectedFeature = searchParams.get("feature") ?? "";
  const selectedSymbol = searchParams.get("symbol") ?? "";
  const selectedEvidence = searchParams.get("evidence") ?? "metadata";
  const sessionId = searchParams.get("sessionId") ?? "";
  const selectedWorkflow = searchParams.get("workflow") ?? "";
  const overview = useGatewayOverview(owner, repo, metadata);
  const sessions = useEngineeringSessions(metadata);
  const createSession = useCreateEngineeringSession(metadata);
  const archiveSession = useArchiveEngineeringSession(metadata);
  const deleteSession = useDeleteEngineeringSession(metadata);
  const currentSession = useEngineeringSession(sessionId, metadata.publishedRevision);
  const engineeringAction = useEngineeringAction(metadata, sessionId, metadata.publishedRevision);
  const attachWorkflow = useAttachWorkflow(metadata, metadata.publishedRevision);
  const lastUpdate = overview.dataUpdatedAt ? new Date(overview.dataUpdatedAt).toISOString() : metadata.updatedAt;
  const evidence = evidenceFor({
    selectedEvidence,
    overview: overview.data?.data,
    diagnostics: overview.data?.diagnostics,
    requestId: overview.data?.requestId,
    metadata,
    session: currentSession.data?.data,
  });

  useEffect(() => {
    if (liveRegionRef.current) liveRegionRef.current.textContent = `${view} view loaded`;
  }, [view]);

  function setParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.push(`/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?${params.toString()}`, { scroll: false });
  }

  function selectEvidence(next: string, openDrawer = false) {
    setParams({ evidence: next });
    if (openDrawer) setEvidenceOpen(true);
  }

  const leftPane = (
    <WorkspaceLeftPane
      metadata={metadata}
      overview={overview.data?.data}
      sessions={sessions.data?.data.sessions ?? []}
      activeSessionId={sessionId}
      sessionsLoading={sessions.isLoading}
      creatingSession={createSession.isPending}
      archivingSession={archiveSession.isPending}
      deletingSession={deleteSession.isPending}
      selectedFile={selectedFile}
      selectedFeature={selectedFeature}
      selectedSymbol={selectedSymbol}
      session={currentSession.data?.data}
      onCreateSession={() => void createSession.mutateAsync({}).then((envelope) => setParams({ sessionId: envelope.data.session.sessionId, view: "overview" }))}
      onSession={(nextSessionId) => setParams({ sessionId: nextSessionId })}
      onArchiveSession={(nextSessionId) => void archiveSession.mutateAsync(nextSessionId)}
      onDeleteSession={(nextSessionId) => void deleteSession.mutateAsync(nextSessionId).then(() => {
        if (nextSessionId === sessionId) setParams({ sessionId: null });
      })}
      onFile={(file) => setParams({ file, evidence: "file" })}
      onFeature={(feature) => setParams({ view: "features", feature, evidence: "feature" })}
      onSymbol={(symbol) => setParams({ view: "symbols", symbol, evidence: "symbol" })}
    />
  );
  const centerPane = (
    <main id={`repository-${view}-workspace`} role="main" aria-label="Repository workspace" className="min-w-0 overflow-auto">
      <WorkspaceTabs value={view} onChange={(next) => setParams({ view: next })} />
      {!guard.ready ? <RepositoryGuardNotice reason={guard.reason} metadata={metadata} /> : null}
      {guard.ready && overview.isError ? <div className="p-4"><ErrorState error={overview.error} retry={() => void overview.refetch()} /></div> : null}
      {guard.ready && overview.isLoading ? <WorkspaceLoading /> : null}
      {guard.ready && overview.data?.partial ? <InlineAlert tone="warning" className="m-4">Gateway returned usable partial data. Diagnostics are available in the evidence panel.</InlineAlert> : null}
      {guard.ready && overview.data ? (
        <div className="p-4 laptop:p-6">
          {view === "overview" ? <SessionConversation
            metadata={metadata}
            sessionId={sessionId}
            session={currentSession.data?.data}
            sessionLoading={currentSession.isLoading}
            sessionError={currentSession.error}
            onRetry={() => void currentSession.refetch()}
            onCreate={() => void createSession.mutateAsync({}).then((envelope) => setParams({ sessionId: envelope.data.session.sessionId }))}
            creating={createSession.isPending}
            actionPending={engineeringAction.isPending}
            actionError={engineeringAction.error}
            onAction={(action, value, signal) => void engineeringAction.mutateAsync({ action, value, signal }).then(() => selectEvidence(action === "query" ? "conversation" : action))}
            workflowId={selectedWorkflow}
            onWorkflowId={(workflow) => setParams({ workflow })}
            attachingWorkflow={attachWorkflow.isPending}
            workflowError={attachWorkflow.error}
            onAttachWorkflow={(workflowId) => {
              if (!sessionId) return;
              void attachWorkflow.mutateAsync({ sessionId, workflowId }).then((envelope) => setParams({ workflow: envelope.data.session.attachedWorkflowId ?? workflowId, evidence: "workflow" }));
            }}
            onEvidence={selectEvidence}
          /> : null}
          {view === "architecture" ? <ArchitectureView overview={overview.data.data} onEvidence={selectEvidence} /> : null}
          {view === "features" ? <FeatureExplorer owner={owner} repo={repo} metadata={metadata} overview={overview.data.data} selectedFeature={selectedFeature} onFeature={(feature) => setParams({ feature, evidence: "feature" })} onEvidence={selectEvidence} /> : null}
          {view === "symbols" ? <SymbolExplorer owner={owner} repo={repo} metadata={metadata} overview={overview.data.data} selectedSymbol={selectedSymbol} onSymbol={(symbol) => setParams({ symbol, evidence: "symbol" })} onEvidence={selectEvidence} /> : null}
          {selectedFile ? <FileViewer metadata={metadata} path={selectedFile} onEvidence={selectEvidence} /> : null}
        </div>
      ) : null}
    </main>
  );
  const rightPane = <EvidencePanel
    evidence={evidence}
    metadata={metadata}
    diagnostics={[...(overview.data?.diagnostics ?? []), ...(currentSession.data?.data.diagnostics ?? [])]}
    onOpenFile={(file) => setParams({ file, evidence: "file" })}
    onOpenSymbol={(symbol) => setParams({ view: "symbols", symbol, evidence: "symbol" })}
  />;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex min-h-14 items-center gap-3 border-b border-border-subtle bg-panel px-3" aria-label="Repository workspace header">
        <Button size="icon-sm" variant="ghost" className="laptop:hidden" onClick={() => setLeftOpen(true)} aria-label="Open repository context"><Menu className="size-4" /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <strong className="truncate type-panel-title">{metadata.displayName}</strong>
            <RepositoryStatusBadge status={metadata.status} />
            <span className="type-metadata text-muted-foreground">REV {metadata.publishedRevision?.slice(0, 8) ?? "missing"}</span>
            <span className="type-metadata text-muted-foreground">BACKEND {guard.ready ? "gateway ready" : "guarded"}</span>
            <span className="type-metadata text-muted-foreground">VIEW {view}</span>
          </div>
        </div>
        <Button size="icon-sm" variant="ghost" className="laptop:hidden" onClick={() => setEvidenceOpen(true)} aria-label="Open evidence"><Info className="size-4" /></Button>
      </header>

      {!desktop ? <div className="border-b border-border-subtle">
        <SegmentedControl label="Mobile workspace panes" value={mobilePane} onValueChange={(value) => setMobilePane(value as typeof mobilePane)} items={[
          { id: "context", label: "Context" },
          { id: "workspace", label: "Workspace" },
          { id: "evidence", label: "Evidence" },
        ]} />
      </div> : null}

      {desktop ? <PanelGroup direction="horizontal" className="flex flex-1">
        <Panel defaultSize={22} minSize={16} maxSize={34} className="min-w-0 border-r border-border-subtle">{leftPane}</Panel>
        <ResizableHandle />
        <Panel defaultSize={54} minSize={36} className="min-w-0">{centerPane}</Panel>
        <ResizableHandle />
        <Panel defaultSize={24} minSize={18} maxSize={36} className="min-w-0 border-l border-border-subtle">{rightPane}</Panel>
      </PanelGroup> : null}

      {!desktop ? <div className="flex-1 overflow-auto">
        <div className={cn(mobilePane !== "context" && "hidden")}>{leftPane}</div>
        <div className={cn(mobilePane !== "workspace" && "hidden")}>{centerPane}</div>
        <div className={cn(mobilePane !== "evidence" && "hidden")}>{rightPane}</div>
      </div> : null}

      <footer role="status" className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle bg-inset px-4 py-1 type-metadata text-muted-foreground">
        <span>Gateway {guard.ready ? "available" : "unavailable"}</span>
        <span>Session {sessionId || "none"}</span>
        <span>Revision {metadata.publishedRevision?.slice(0, 12) ?? "missing"}</span>
        <span>Last update {lastUpdate}</span>
      </footer>
      <div ref={liveRegionRef} className="sr-only" aria-live="polite" />
      <Drawer open={leftOpen} label="Repository context" side="left" onClose={() => setLeftOpen(false)}>
        <DrawerHeader title="Repository context" onClose={() => setLeftOpen(false)} />
        {leftPane}
      </Drawer>
      <Drawer open={evidenceOpen} label="Repository evidence" side="right" onClose={() => setEvidenceOpen(false)}>
        <DrawerHeader title="Evidence" onClose={() => setEvidenceOpen(false)} />
        {rightPane}
      </Drawer>
    </div>
  );
}

function useDesktopLayout() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const query = typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 1081px)")
      : null;
    if (!query) return;
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

function WorkspaceTabs({ value, onChange }: { value: WorkspaceView; onChange(value: WorkspaceView): void }) {
  return <div className="sticky top-0 z-10 border-b border-border-subtle bg-panel"><SegmentedControl label="Repository views" items={VIEW_TABS} value={value} onValueChange={(next) => onChange(parseView(next))} /></div>;
}

function WorkspaceLeftPane(props: {
  metadata: RepositoryMetadata;
  overview?: RepositoryGatewayOverview;
  sessions: RepositorySessionSummary[];
  activeSessionId: string;
  sessionsLoading: boolean;
  creatingSession: boolean;
  archivingSession: boolean;
  deletingSession: boolean;
  selectedFile: string;
  selectedFeature: string;
  selectedSymbol: string;
  session?: RepositorySessionDetail;
  onCreateSession(): void;
  onSession(sessionId: string): void;
  onArchiveSession(sessionId: string): void;
  onDeleteSession(sessionId: string): void;
  onFile(path: string): void;
  onFeature(feature: string): void;
  onSymbol(symbol: string): void;
}) {
  const featureNames = useMemo(() => featureOptions(props.overview), [props.overview]);
  const symbolNames = useMemo(() => symbolOptions(props.overview), [props.overview]);
  return (
    <aside aria-label="Repository context" className="h-full overflow-auto bg-sidebar p-3">
      <SessionHistory
        sessions={props.sessions}
        activeSessionId={props.activeSessionId}
        loading={props.sessionsLoading}
        creating={props.creatingSession}
        archiving={props.archivingSession}
        deleting={props.deletingSession}
        onCreate={props.onCreateSession}
        onOpen={props.onSession}
        onArchive={props.onArchiveSession}
        onDelete={props.onDeleteSession}
      />
      <SectionTitle icon={ListTree} title="Repository Tree" />
      <RepositoryTree metadata={props.metadata} selectedFile={props.selectedFile} onFile={props.onFile} />
      <ContextList title="Features" values={featureNames} selected={props.selectedFeature} onSelect={props.onFeature} empty="No features returned." />
      <ContextList title="Symbols" values={symbolNames} selected={props.selectedSymbol} onSelect={props.onSymbol} empty="No symbols returned." />
      <PinnedContext
        file={props.selectedFile}
        feature={props.selectedFeature}
        symbol={props.selectedSymbol}
        session={props.session}
      />
      <section className="mt-5" aria-label="Repository context metadata">
        <h2 className="type-metadata-label text-muted-foreground">Context</h2>
        <dl className="mt-2 space-y-2 type-compact">
          <Meta label="Repository" value={props.metadata.repositoryId} />
          <Meta label="Status" value={props.metadata.status} />
          <Meta label="Revision" value={props.metadata.publishedRevision ?? "missing"} />
        </dl>
      </section>
    </aside>
  );
}

function SessionHistory(props: {
  sessions: RepositorySessionSummary[];
  activeSessionId: string;
  loading: boolean;
  creating: boolean;
  archiving: boolean;
  deleting: boolean;
  onCreate(): void;
  onOpen(sessionId: string): void;
  onArchive(sessionId: string): void;
  onDelete(sessionId: string): void;
}) {
  const [search, setSearch] = useState("");
  const filtered = props.sessions.filter((session) =>
    [session.sessionId, session.lifecycle, session.activeFeature, session.activeModule, session.lastEventKind]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()));
  const recent = filtered.filter((session) => session.lifecycle !== "archived");
  const archived = filtered.filter((session) => session.lifecycle === "archived");
  return (
    <section className="mb-5" aria-label="Session history">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle icon={MessageSquare} title="Session history" />
        <Button size="icon-sm" variant="ghost" onClick={props.onCreate} disabled={props.creating} aria-label="Start engineering session"><Play className="size-4" /></Button>
      </div>
      <label className="mt-2 block">
        <span className="sr-only">Search sessions</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-full rounded-control border border-border bg-inset px-2 type-compact focus-ring" placeholder="Search sessions" />
      </label>
      <div className="mt-2 max-h-52 overflow-auto border-y border-border-subtle py-1">
        {props.loading ? <LoadingRows rows={3} /> : null}
        <SessionGroup title="Recent sessions" sessions={recent} activeSessionId={props.activeSessionId} archiving={props.archiving} deleting={props.deleting} onOpen={props.onOpen} onArchive={props.onArchive} onDelete={props.onDelete} />
        <SessionGroup title="Archived sessions" sessions={archived} activeSessionId={props.activeSessionId} archiving={props.archiving} deleting={props.deleting} onOpen={props.onOpen} onArchive={props.onArchive} onDelete={props.onDelete} />
        {!props.loading && filtered.length === 0 ? <p className="px-2 py-3 type-compact text-muted-foreground">No matching sessions.</p> : null}
      </div>
    </section>
  );
}

function SessionGroup({ title, sessions, activeSessionId, archiving, deleting, onOpen, onArchive, onDelete }: {
  title: string;
  sessions: RepositorySessionSummary[];
  activeSessionId: string;
  archiving: boolean;
  deleting: boolean;
  onOpen(sessionId: string): void;
  onArchive(sessionId: string): void;
  onDelete(sessionId: string): void;
}) {
  if (sessions.length === 0) return null;
  return <div className="py-1"><p className="px-2 py-1 type-metadata-label text-muted-foreground">{title}</p>{sessions.map((session) => (
    <div key={session.sessionId} className={cn("group flex items-center gap-1 rounded-control transition-colors duration-[150ms]", activeSessionId === session.sessionId && "bg-selection")}>
      <button className="min-w-0 flex-1 px-2 py-2 text-left focus-ring" aria-current={activeSessionId === session.sessionId ? "page" : undefined} onClick={() => onOpen(session.sessionId)}>
        <span className="block truncate type-compact-strong">{session.sessionId}</span>
        <span className="block truncate type-metadata text-muted-foreground">{session.lifecycle} · {session.eventCount} events</span>
      </button>
      <Button size="icon-sm" variant="ghost" disabled={archiving} onClick={() => onArchive(session.sessionId)} aria-label={`Archive ${session.sessionId}`}><X className="size-3.5" /></Button>
      <Button size="icon-sm" variant="ghost" disabled={deleting} onClick={() => onDelete(session.sessionId)} aria-label={`Delete ${session.sessionId}`}><Trash2 className="size-3.5" /></Button>
    </div>
  ))}</div>;
}

function PinnedContext({ file, feature, symbol, session }: { file: string; feature: string; symbol: string; session?: RepositorySessionDetail }) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const chips = [
    file ? `File: ${file}` : null,
    feature ? `Feature: ${feature}` : null,
    symbol ? `Symbol: ${symbol}` : null,
    session?.context.activeArchitecture ? `Architecture: ${session.context.activeArchitecture}` : null,
    session?.context.activeWorkflow ? `Workflow: ${session.context.activeWorkflow}` : null,
    ...((session?.context.recentFiles ?? []).slice(0, 3).map((item) => `Recent file: ${item}`)),
    ...((session?.context.recentFeatures ?? []).slice(0, 3).map((item) => `Recent feature: ${item}`)),
    ...((session?.context.recentSymbols ?? []).slice(0, 3).map((item) => `Recent symbol: ${item}`)),
  ].filter((item): item is string => typeof item === "string" && !removed.has(item));
  return (
    <section className="mt-5" aria-label="Pinned context">
      <div className="flex items-center gap-2"><Pin className="size-4 text-muted-foreground" /><h2 className="type-metadata-label text-muted-foreground">Pinned context</h2></div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => <button key={chip} className="max-w-full truncate rounded-badge bg-selection px-2 py-1 type-metadata text-foreground focus-ring" onClick={() => setRemoved((current) => new Set([...current, chip]))} aria-label={`Remove ${chip}`}>{chip} ×</button>)}
        {chips.length === 0 ? <p className="type-compact text-muted-foreground">No context pinned.</p> : null}
      </div>
    </section>
  );
}

function RepositoryTree({ metadata, selectedFile, onFile }: { metadata: RepositoryMetadata; selectedFile: string; onFile(path: string): void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ "": true });
  return (
    <div role="tree" aria-label="Repository files" className="mt-2 max-h-[32dvh] overflow-auto border-y border-border-subtle py-2 type-compact">
      <TreeDirectory metadata={metadata} path="" level={1} open={open} setOpen={setOpen} selectedFile={selectedFile} onFile={onFile} />
    </div>
  );
}

function TreeDirectory(props: {
  metadata: RepositoryMetadata;
  path: string;
  level: number;
  open: Record<string, boolean>;
  setOpen(next: Record<string, boolean> | ((state: Record<string, boolean>) => Record<string, boolean>)): void;
  selectedFile: string;
  onFile(path: string): void;
}) {
  const expanded = props.open[props.path] ?? false;
  const query = useRepositoryDirectory(props.metadata, props.path, expanded);
  const entries = (query.data ?? []).map((entry) => normalizeEntry(entry, props.path)).sort((a, b) => Number(a.type === "file") - Number(b.type === "file") || a.name.localeCompare(b.name));
  const name = props.path ? props.path.split("/").pop() ?? props.path : props.metadata.repo;

  function toggle() {
    props.setOpen((state) => ({ ...state, [props.path]: !expanded }));
  }

  return (
    <div>
      <button role="treeitem" aria-expanded={expanded} aria-selected="false" aria-level={props.level} className="flex min-h-8 w-full items-center gap-1 rounded-control px-1 text-left hover:bg-hover focus-ring" onClick={toggle} onKeyDown={(event) => treeKey(event, toggle)}>
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Folder className="size-3.5 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </button>
      {expanded ? <div role="group" className="pl-3">
        {query.isLoading ? <Skeleton className="my-2 h-7" /> : null}
        {query.isError ? <p className="px-1 py-2 type-compact text-danger">Directory unavailable</p> : null}
        {entries.map((entry) => entry.type === "directory" ? (
          <TreeDirectory key={entry.path} {...props} path={entry.path} level={props.level + 1} />
        ) : (
          <button key={entry.path} role="treeitem" aria-selected={props.selectedFile === entry.path} aria-level={props.level + 1} className={cn("flex min-h-8 w-full items-center gap-1 rounded-control px-1 text-left hover:bg-hover focus-ring", props.selectedFile === entry.path && "bg-selection text-foreground")} onClick={() => props.onFile(entry.path)}>
            <span className="w-3.5" />
            <File className="size-3.5 text-muted-foreground" />
            <span className="truncate">{entry.name}</span>
          </button>
        ))}
        {!query.isLoading && entries.length === 0 ? <p className="px-1 py-2 type-compact text-muted-foreground">Empty directory</p> : null}
      </div> : null}
    </div>
  );
}

function OverviewView({ overview, repository, onEvidence }: { overview: RepositoryGatewayOverview; repository: RepositoryMetadata; onEvidence(key: string): void }) {
  return (
    <article aria-labelledby="overview-heading" className="space-y-6">
      <ViewHeader eyebrow="Overview" title="Repository documentation" description="Published repository information from the gateway overview." />
      <DocumentationSection title="Architecture summary" value={overview.architecture} empty="No architecture summary returned." onInspect={() => onEvidence("architecture")} />
      <DocumentationSection title="Code organization" value={overview.codeOrganization} empty="No code organization returned." onInspect={() => onEvidence("organization")} />
      <DocumentationSection title="Quality" value={overview.quality} empty="No quality analysis returned." onInspect={() => onEvidence("quality")} />
      <DocumentationSection title="Evolution summary" value={overview.evolution} empty="No evolution summary returned." onInspect={() => onEvidence("evolution")} />
      <DocumentationSection title="Statistics" value={overview.metrics ?? ({ status: repository.status, currentRevision: repository.currentRevision, indexedRevision: repository.indexedRevision, publishedRevision: repository.publishedRevision } satisfies JsonRecord)} empty="No statistics returned." onInspect={() => onEvidence("metrics")} />
    </article>
  );
}

function SessionConversation(props: {
  metadata: RepositoryMetadata;
  sessionId: string;
  session?: RepositorySessionDetail;
  sessionLoading: boolean;
  sessionError: unknown;
  onRetry(): void;
  onCreate(): void;
  creating: boolean;
  actionPending: boolean;
  actionError: unknown;
  onAction(action: "query" | "plan" | "specification" | "insights" | "execution", value: string, signal?: AbortSignal): void;
  workflowId: string;
  onWorkflowId(workflowId: string): void;
  attachingWorkflow: boolean;
  workflowError: unknown;
  onAttachWorkflow(workflowId: string): void;
  onEvidence(key: string): void;
}) {
  const [draft, setDraft] = useState("");
  const [action, setAction] = useState<"query" | "plan" | "specification" | "insights" | "execution">("query");
  const listRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [props.session?.events.length, props.actionPending]);
  useEffect(() => {
    if (liveRef.current && props.actionPending) liveRef.current.textContent = "Engineering action is running.";
  }, [props.actionPending]);

  function submit() {
    if (!props.sessionId || props.actionPending) return;
    if (action !== "insights" && !draft.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    props.onAction(action, action === "insights" ? "Repository insights" : draft.trim(), controller.signal);
    if (action === "query") setDraft("");
  }

  function updateDraft(value: string) {
    setDraft(value);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
    });
  }

  if (!props.sessionId) {
    return (
      <section aria-label="Engineering session workspace" className="space-y-5">
        <ViewHeader eyebrow="Engineering Session" title="Persistent AI workspace" description="Start or reopen a repository session to maintain engineering context." />
        <EmptyState icon={MessageSquare} title="No session" description="Create a repository session to ask questions, generate plans, inspect evidence, and attach workflows." action={<Button onClick={props.onCreate} disabled={props.creating}><Play className="size-4" />Start engineering session</Button>} />
        <OverviewView overview={{}} repository={props.metadata} onEvidence={props.onEvidence} />
      </section>
    );
  }

  if (props.sessionLoading) return <WorkspaceLoading />;
  if (props.sessionError || !props.session) return <ErrorState error={props.sessionError} retry={props.onRetry} />;

  const outputs = props.session.events.filter((event) => ["plan", "specification", "execution_summary", "insight"].includes(event.kind));

  return (
    <section aria-label="Engineering session workspace" className="grid min-h-[calc(100dvh-12rem)] gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle pb-4">
        <div>
          <p className="type-section-eyebrow text-muted-foreground">Engineering Session</p>
          <h1 className="mt-2 type-section-title">{props.session.session.sessionId}</h1>
          <p className="mt-1 type-compact text-muted-foreground">{props.session.session.lifecycle} · revision {props.session.session.revision.slice(0, 8)}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => props.onEvidence("conversation")}>Inspect evidence</Button>
      </div>

      <ActiveContextChips session={props.session} />

      <ContextComposer session={props.session} draft={draft} onApply={(chip) => updateDraft(draft ? `${draft}\n\n${chip}` : chip)} />

      <div ref={listRef} className="max-h-[42dvh] overflow-auto scroll-smooth border-y border-border-subtle motion-reduce:scroll-auto" aria-label="Conversation history">
        {props.session.events.map((event) => <ConversationEvent key={event.eventId} event={event} onEvidence={props.onEvidence} />)}
        {props.actionPending ? <TypingIndicator onAbort={() => abortRef.current?.abort()} /> : null}
        {props.session.events.length === 0 && !props.actionPending ? <EmptyState icon={MessageSquare} title="Empty conversation" description="Ask an engineering question or generate an output for this repository session." compact /> : null}
      </div>

      <div className="grid gap-3 laptop:grid-cols-[180px_minmax(0,1fr)_auto]">
        <Selector label="Engineering action" value={action} options={["query", "plan", "specification", "execution", "insights"]} onChange={(value) => setAction(value as typeof action)} />
        <label>
          <span className="type-metadata-label text-muted-foreground">Question or objective</span>
          <textarea ref={textareaRef} className="mt-1 min-h-20 w-full resize-none rounded-control border border-border bg-inset px-3 py-2 type-compact transition-[height,border-color] duration-[150ms] focus-ring" value={draft} disabled={props.actionPending} onChange={(event) => updateDraft(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Backspace") updateDraft(""); if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder={action === "insights" ? "No input required" : "Ask a question or describe the engineering objective"} />
        </label>
        <div className="flex items-end gap-2">
          <Button variant="secondary" className="self-end" onClick={() => updateDraft("")} disabled={!draft || props.actionPending}>Clear</Button>
          {props.actionPending ? <Button variant="destructive" className="self-end" onClick={() => abortRef.current?.abort()}>Abort</Button> : <Button className="self-end" onClick={submit} disabled={action !== "insights" && !draft.trim()}><Send className="size-4" />Run</Button>}
        </div>
      </div>
      <SuggestedPrompts onSelect={updateDraft} />
      {props.actionError ? <ErrorState error={props.actionError} compact /> : null}

      <EngineeringOutputs outputs={outputs} onEvidence={props.onEvidence} />
      <WorkflowPanel
        session={props.session}
        workflowId={props.workflowId}
        onWorkflowId={props.onWorkflowId}
        attaching={props.attachingWorkflow}
        error={props.workflowError}
        onAttach={props.onAttachWorkflow}
      />
      <div ref={liveRef} className="sr-only" aria-live="polite" />
    </section>
  );
}

function ContextComposer({ session, draft, onApply }: { session: RepositorySessionDetail; draft: string; onApply(value: string): void }) {
  const chips = [
    ...session.context.recentFiles.map((item) => `file:${item}`),
    ...session.context.recentFeatures.map((item) => `feature:${item}`),
    ...session.context.recentSymbols.map((item) => `symbol:${item}`),
    session.context.activeArchitecture ? `architecture:${session.context.activeArchitecture}` : null,
    session.context.activeWorkflow ? `workflow:${session.context.activeWorkflow}` : null,
  ].filter((item): item is string => typeof item === "string" && !draft.includes(item));
  return <section aria-label="Context composer" className="rounded-control border border-border-subtle bg-inset p-3"><div className="flex items-center gap-2"><Pin className="size-4 text-muted-foreground" /><h2 className="type-metadata-label text-muted-foreground">Context composer</h2></div><div className="mt-2 flex flex-wrap gap-1.5">{chips.map((chip) => <button key={chip} className="inline-flex items-center gap-1 rounded-badge bg-interactive px-2 py-1 type-metadata text-text-secondary hover:bg-hover hover:text-foreground focus-ring" onClick={() => onApply(`Attach ${chip}`)}><Plus className="size-3" />{chip}</button>)}{chips.length === 0 ? <p className="type-compact text-muted-foreground">No additional context suggestions.</p> : null}</div></section>;
}

function SuggestedPrompts({ onSelect }: { onSelect(value: string): void }) {
  const prompts = [
    "Summarize the risk in this implementation.",
    "Generate a step-by-step plan for this change.",
    "Draft an engineering specification with acceptance criteria.",
    "Check execution readiness and missing context.",
  ];
  return <div aria-label="Suggested prompts" className="flex flex-wrap gap-1.5">{prompts.map((prompt) => <button key={prompt} className="rounded-badge border border-border-subtle px-2 py-1 type-metadata text-muted-foreground hover:bg-hover hover:text-foreground focus-ring" onClick={() => onSelect(prompt)}>{prompt}</button>)}</div>;
}

function TypingIndicator({ onAbort }: { onAbort(): void }) {
  return <div role="status" className="border-t border-border-subtle p-3"><div className="flex items-center justify-between gap-3"><p className="type-metadata-label text-muted-foreground">Giro is composing</p><Button variant="ghost" size="sm" onClick={onAbort}>Abort request</Button></div><div className="mt-3 space-y-2" aria-label="Streaming placeholder"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-1/2" /></div><p className="mt-2 type-compact text-muted-foreground">Streaming placeholder. Waiting for backend result...</p></div>;
}

function ActiveContextChips({ session }: { session: RepositorySessionDetail }) {
  const values = [
    session.context.activeFeature ? `Feature: ${session.context.activeFeature}` : null,
    session.context.activeModule ? `Module: ${session.context.activeModule}` : null,
    session.context.activeWorkflow ? `Workflow: ${session.context.activeWorkflow}` : null,
    ...session.context.recentFiles.slice(0, 3).map((item) => `File: ${item}`),
    ...session.context.recentSymbols.slice(0, 3).map((item) => `Symbol: ${item}`),
  ].filter((item): item is string => Boolean(item));
  return <div aria-label="Active context chips" className="flex flex-wrap gap-1.5">{values.map((item) => <span className="rounded-badge bg-selection px-2 py-1 type-metadata" key={item}>{item}</span>)}{values.length === 0 ? <p className="type-compact text-muted-foreground">No context attached to this session yet.</p> : null}</div>;
}

function ConversationEvent({ event, onEvidence }: { event: RepositorySessionEvent; onEvidence(key: string): void }) {
  const heading = event.kind.replace(/_/g, " ");
  return (
    <article className="border-t border-border-subtle p-3 first:border-t-0" aria-label={`${event.kind} event`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="capitalize type-panel-title">{heading}</h2>
        <button className="type-metadata text-muted-foreground underline-offset-4 hover:underline focus-ring" onClick={() => onEvidence(event.kind)}>{event.referenceId}</button>
      </div>
      <div className="mt-2"><MarkdownMessage>{event.summary}</MarkdownMessage></div>
      <p className="mt-2 type-metadata text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</p>
      <ReasoningDetails attributes={event.attributes} />
      {!isEmptyValue(event.attributes) ? <details className="mt-2"><summary className="cursor-pointer type-metadata-label text-muted-foreground">Request metadata</summary><div className="mt-2">{renderValue(event.attributes)}</div></details> : null}
    </article>
  );
}

function ReasoningDetails({ attributes }: { attributes: JsonRecord }) {
  const reasoning = attributes.reasoning ?? attributes.rationale ?? attributes.analysis;
  if (typeof reasoning !== "string" || !reasoning.trim()) return null;
  return <details className="mt-3 rounded-control bg-inset p-3"><summary className="cursor-pointer type-metadata-label text-muted-foreground">Reasoning</summary><div className="mt-2"><MarkdownMessage>{reasoning}</MarkdownMessage></div></details>;
}

function EngineeringOutputs({ outputs, onEvidence }: { outputs: RepositorySessionEvent[]; onEvidence(key: string): void }) {
  return (
    <section aria-label="Engineering outputs" className="border-t border-border-subtle pt-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="type-panel-title">Engineering outputs</h2>
        <Button variant="ghost" size="sm" onClick={() => onEvidence("outputs")}>Evidence</Button>
      </div>
      <div className="mt-3 grid gap-2">
        {outputs.map((event) => <details key={event.eventId} className="border-y border-border-subtle py-2"><summary className="cursor-pointer capitalize type-compact-strong">{event.kind.replace(/_/g, " ")}</summary><div className="mt-2">{renderValue(event.attributes)}</div></details>)}
        {outputs.length === 0 ? <p className="type-compact text-muted-foreground">No engineering outputs generated yet.</p> : null}
      </div>
    </section>
  );
}

function WorkflowPanel(props: {
  session: RepositorySessionDetail;
  workflowId: string;
  onWorkflowId(workflowId: string): void;
  attaching: boolean;
  error: unknown;
  onAttach(workflowId: string): void;
}) {
  const workflow = props.session.session.attachedWorkflowId;
  return (
    <section aria-label="Workflow" className="border-t border-border-subtle pt-4">
      <h2 className="type-panel-title">Workflow</h2>
      {workflow ? (
        <dl className="mt-3 grid gap-2 type-compact">
          <Meta label="Attached workflow" value={workflow} />
          <Meta label="Workflow state" value={props.session.session.workflowState ?? "missing"} />
          <Meta label="Current stage" value={props.session.session.workflowStage ?? "missing"} />
          <Meta label="Attached at" value={props.session.session.attachedAt ?? "missing"} />
        </dl>
      ) : <p className="mt-2 type-compact text-muted-foreground">No workflow attached.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <input className="h-10 min-w-0 flex-1 rounded-control border border-border bg-inset px-3 type-compact focus-ring" value={props.workflowId} onChange={(event) => props.onWorkflowId(event.target.value)} placeholder="workflow id" aria-label="Workflow ID" />
        <Button variant="secondary" onClick={() => props.onAttach(props.workflowId.trim())} disabled={props.attaching || !props.workflowId.trim()}>Attach workflow</Button>
      </div>
      {props.error ? <div className="mt-3"><ErrorState error={props.error} compact /></div> : null}
      <details className="mt-3"><summary className="cursor-pointer type-metadata-label text-muted-foreground">Timeline</summary>{props.session.events.length > 0 ? <ol className="mt-2 space-y-2">{props.session.events.map((event) => <li className="type-compact" key={event.eventId}>{event.sequence}. {event.kind} · {event.createdAt}</li>)}</ol> : <p className="mt-2 type-compact text-muted-foreground">No workflow timeline events returned.</p>}</details>
    </section>
  );
}

function ArchitectureView({ overview, onEvidence }: { overview: RepositoryGatewayOverview; onEvidence(key: string): void }) {
  const architecture = asRecord(overview.architecture);
  const organization = asRecord(overview.codeOrganization);
  return (
    <article className="space-y-6" aria-labelledby="architecture-heading">
      <ViewHeader eyebrow="Architecture" title="Repository structure" description="Subsystems, packages, layers, dependencies, and hotspots from published intelligence." />
      <DocumentationSection title="Subsystems" value={overview.subsystems ?? architecture?.subsystems ?? architecture?.subsystemIds} empty="No subsystems returned." onInspect={() => onEvidence("architecture")} />
      <DocumentationSection title="Packages" value={architecture?.packageHierarchy} empty="No package hierarchy returned." />
      <DocumentationSection title="Layers" value={architecture?.layers} empty="No layers returned." />
      <DocumentationSection title="Hotspots" value={architecture?.hotspots} empty="No hotspots returned." />
      <DocumentationSection title="Dependencies" value={architecture?.dependencyGraph} empty="No dependencies returned." />
      <DocumentationSection title="Fan-in" value={organization?.highestFanIn ?? organization?.mostImportedFiles} empty="No fan-in data returned." />
      <DocumentationSection title="Fan-out" value={organization?.highestFanOut} empty="No fan-out data returned." />
      <DocumentationSection title="Cycles" value={organization?.cyclicDependencies} empty="No dependency cycles returned." />
      <DocumentationSection title="Utility modules" value={organization?.utilityClusters} empty="No utility modules returned." />
    </article>
  );
}

function FeatureExplorer(props: {
  owner: string;
  repo: string;
  metadata: RepositoryMetadata;
  overview: RepositoryGatewayOverview;
  selectedFeature: string;
  onFeature(feature: string): void;
  onEvidence(key: string): void;
}) {
  const featureNames = featureOptions(props.overview);
  const [operation, setOperation] = useState<FeatureNavigationOperation>("feature");
  const selected = props.selectedFeature || featureNames[0] || "";
  const query = useFeatureNavigation(props.owner, props.repo, props.metadata, operation, selected, Boolean(selected));
  const onFeature = props.onFeature;
  useEffect(() => {
    if (!props.selectedFeature && selected) onFeature(selected);
  }, [onFeature, props.selectedFeature, selected]);
  return (
    <section className="space-y-5" aria-labelledby="features-heading">
      <ViewHeader eyebrow="Feature Explorer" title="Features" description="Navigate feature summaries, files, symbols, dependencies, and flow." />
      <Selector label="Feature selector" value={selected} options={featureNames} placeholder="No features returned" onChange={props.onFeature} />
      <Selector label="Feature operation" value={operation} options={FEATURE_OPERATIONS} onChange={(value) => setOperation(value as FeatureNavigationOperation)} />
      {query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} compact /> : null}
      {query.isLoading ? <Skeleton className="h-32" /> : null}
      {!selected ? <EmptyState icon={GitBranch} title="No feature selected" description="Published feature intelligence did not return feature names." compact /> : null}
      {query.data ? (
        <div className="grid gap-4">
          {query.data.partial ? <InlineAlert tone="warning">Feature response is partial; diagnostics remain usable.</InlineAlert> : null}
          <DocumentationSection title="Feature summary" value={(query.data.data.feature ?? query.data.data.features ?? query.data.data) as JsonValue} empty="Empty feature result." onInspect={() => props.onEvidence("feature")} />
          <DocumentationSection title="Related files" value={query.data.data.files ?? query.data.data.feature?.files} empty="No files returned." onInspect={() => props.onEvidence("files")} />
          <DocumentationSection title="Related symbols" value={query.data.data.symbols ?? query.data.data.feature?.symbolIds} empty="No symbols returned." onInspect={() => props.onEvidence("symbols")} />
          <DocumentationSection title="Relationships" value={query.data.data.relationships} empty="No relationships returned." onInspect={() => props.onEvidence("relationships")} />
          <DocumentationSection title="Flow" value={query.data.data.flows} empty="No flow returned." />
        </div>
      ) : null}
    </section>
  );
}

function SymbolExplorer(props: {
  owner: string;
  repo: string;
  metadata: RepositoryMetadata;
  overview: RepositoryGatewayOverview;
  selectedSymbol: string;
  onSymbol(symbol: string): void;
  onEvidence(key: string): void;
}) {
  const [operation, setOperation] = useState<SemanticNavigationOperation>("definition");
  const [draft, setDraft] = useState(props.selectedSymbol || "");
  const symbolNames = symbolOptions(props.overview);
  const queryValue = props.selectedSymbol || draft;
  const query = useSemanticNavigation(props.owner, props.repo, props.metadata, operation, queryValue, Boolean(queryValue));
  return (
    <section className="space-y-5" aria-labelledby="symbols-heading">
      <ViewHeader eyebrow="Symbol Explorer" title="Symbols" description="Search definitions and relationships through the semantic gateway." />
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); props.onSymbol(draft.trim()); }}>
        <label className="min-w-0 flex-1">
          <span className="type-metadata-label text-muted-foreground">Search</span>
          <input className="mt-1 h-10 w-full rounded-control border border-border bg-inset px-3 type-compact focus-ring" value={draft} list="repository-symbol-options" onChange={(event) => setDraft(event.target.value)} placeholder="Search symbols" />
        </label>
        <Button className="self-end" type="submit"><Search className="size-4" />Search</Button>
        <datalist id="repository-symbol-options">{symbolNames.map((symbol) => <option key={symbol} value={symbol} />)}</datalist>
      </form>
      <Selector label="Semantic operation" value={operation} options={SEMANTIC_OPERATIONS} onChange={(value) => setOperation(value as SemanticNavigationOperation)} />
      {query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} compact /> : null}
      {query.isLoading || query.isFetching ? <Skeleton className="h-24" /> : null}
      {!queryValue ? <EmptyState icon={Braces} title="No symbol selected" description="Search or select a symbol to inspect semantic relationships." compact /> : null}
      {query.data ? (
        <div className="grid gap-4">
          {query.data.partial ? <InlineAlert tone="warning">Semantic response is partial; diagnostics remain usable.</InlineAlert> : null}
          <DocumentationSection title="Symbol details" value={query.data.data.symbols} empty="No symbol details returned." onInspect={() => props.onEvidence("symbol")} />
          <DocumentationSection title="Relationship list" value={query.data.data.relationships} empty="No relationships returned." onInspect={() => props.onEvidence("relationships")} />
          <DocumentationSection title="Metadata" value={query.data.data as JsonValue} empty="No semantic metadata returned." />
        </div>
      ) : null}
    </section>
  );
}

function FileViewer({ metadata, path, onEvidence }: { metadata: RepositoryMetadata; path: string; onEvidence(key: string): void }) {
  const query = useRepositoryFile(metadata, path, Boolean(path));
  return (
    <section className="mt-6 border-t border-border-subtle pt-5" aria-label="File viewer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="type-section-eyebrow text-muted-foreground">File Viewer</p>
          <h2 className="mt-1 break-all type-section-title">{path}</h2>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onEvidence("file")}>Inspect evidence</Button>
      </div>
      {query.isLoading ? <Skeleton className="mt-4 h-64" /> : null}
      {query.isError ? <div className="mt-4"><ErrorState error={query.error} retry={() => void query.refetch()} compact /></div> : null}
      {query.data ? <RenderedFile file={query.data} /> : null}
    </section>
  );
}

function RenderedFile({ file }: { file: FileReadResult }) {
  const large = file.sizeBytes > 524_288 || file.content.length > 524_288;
  const unknown = !file.language || file.language === "unknown";
  const binary = looksBinary(file.content);
  if (binary) return <InlineAlert tone="warning" className="mt-4">Binary file content is not rendered.</InlineAlert>;
  if (large) return <InlineAlert tone="warning" className="mt-4">Large file content is truncated by the backend response.</InlineAlert>;
  return (
    <div className="mt-4 overflow-hidden rounded-control border border-border-subtle bg-code">
      <div className="flex h-9 items-center gap-3 border-b border-border-subtle px-3 type-metadata text-muted-foreground">
        <span>{unknown ? "text" : file.language}</span>
        <span>{file.lineCount} lines</span>
        <span>{file.sizeBytes} bytes</span>
      </div>
      <pre className="max-h-[56dvh] overflow-auto p-4 type-mono text-code-foreground"><code>{file.content}</code></pre>
    </div>
  );
}

function EvidencePanel({ evidence, metadata, diagnostics, onOpenFile, onOpenSymbol }: { evidence: Evidence; metadata: RepositoryMetadata; diagnostics: NormalizedDiagnostic[]; onOpenFile(path: string): void; onOpenSymbol(symbol: string): void }) {
  const detailsText = stringifyEvidence(evidence.value);
  const confidence = findNestedValue(evidence.value, "confidence");
  return (
    <aside aria-label="Evidence" className="h-full overflow-auto bg-panel">
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-panel p-4">
        <p className="type-section-eyebrow text-muted-foreground">Evidence</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h2 className="type-section-title">{evidence.title}</h2>
          <CopyControl value={detailsText} label={`Copy ${evidence.title} evidence`} />
        </div>
      </div>
      <div className="p-4">
        <div className="grid gap-3">
          <EvidenceLine label="Kind" value={evidence.kind} />
          <EvidenceLine label="Repository" value={metadata.repositoryId} />
          <EvidenceLine label="Revision" value={metadata.publishedRevision ?? "missing"} />
          {evidence.requestId ? <EvidenceLine label="Request ID" value={evidence.requestId} /> : null}
          {confidence !== undefined ? <EvidenceLine label="Confidence" value={typeof confidence === "object" ? JSON.stringify(confidence) : String(confidence)} /> : null}
        </div>
        <details className="mt-5" open>
          <summary className="cursor-pointer type-metadata-label text-muted-foreground">Details</summary>
          <div className="mt-2">{renderEvidenceValue(evidence.value, onOpenFile, onOpenSymbol)}</div>
        </details>
        <details className="mt-5" open={diagnostics.length > 0}>
          <summary className="cursor-pointer type-metadata-label text-muted-foreground">Diagnostics</summary>
          {diagnostics.length > 0 ? <div className="mt-2 space-y-2">{diagnostics.map((item) => <DiagnosticItem key={`${item.code}-${item.message}`} item={item} />)}</div> : <p className="mt-2 type-compact text-muted-foreground">No diagnostics returned.</p>}
        </details>
      </div>
    </aside>
  );
}

function renderEvidenceValue(value: JsonValue | NormalizedDiagnostic[] | undefined, onOpenFile: (path: string) => void, onOpenSymbol: (symbol: string) => void): ReactNode {
  if (Array.isArray(value)) {
    return <div className="grid gap-2">{value.map((item, index) => <EvidenceCard key={index} value={item as JsonValue} index={index} onOpenFile={onOpenFile} onOpenSymbol={onOpenSymbol} />)}</div>;
  }
  return renderValue(value);
}

function EvidenceCard({ value, index, onOpenFile, onOpenSymbol }: { value: JsonValue; index: number; onOpenFile(path: string): void; onOpenSymbol(symbol: string): void }) {
  const record = asRecord(value);
  if (!record) return <div className="type-compact">{String(value)}</div>;
  const file = stringField(record, ["file", "path", "filePath", "relativeFilePath"]) ?? findStringFieldDeep(record, ["file", "path", "filePath", "relativeFilePath"]);
  const symbol = stringField(record, ["symbol", "symbolId", "qualifiedName", "name"]) ?? findStringFieldDeep(record, ["symbol", "symbolId", "qualifiedName", "name"]);
  const range = findLineRange(record);
  return (
    <details className="rounded-control border border-border-subtle p-3" open={index < 2}>
      <summary className="cursor-pointer type-compact-strong">{file ?? symbol ?? `Evidence ${index + 1}`}</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        {file ? <Button variant="ghost" size="sm" onClick={() => onOpenFile(file)}>Open related file</Button> : null}
        {symbol ? <Button variant="ghost" size="sm" onClick={() => onOpenSymbol(symbol)}>Open related symbol</Button> : null}
        <CopyControl value={JSON.stringify(record, null, 2)} label="Copy evidence item" />
      </div>
      {range ? <p className="mt-2 type-metadata text-muted-foreground">Lines {range.start} - {range.end}</p> : null}
      <div className="mt-3">{renderValue(record)}</div>
    </details>
  );
}

function DocumentationSection({ title, value, empty, onInspect }: { title: string; value: JsonValue | undefined; empty: string; onInspect?: () => void }) {
  const hasValue = !isEmptyValue(value);
  return (
    <section className="border-t border-border-subtle pt-4" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-panel-title">{title}</h2>
        {onInspect ? <Button variant="ghost" size="sm" onClick={onInspect}>Evidence</Button> : null}
      </div>
      <div className="mt-3">{hasValue ? renderValue(value) : <p className="type-compact text-muted-foreground">{empty}</p>}</div>
    </section>
  );
}

function renderValue(value: JsonValue | NormalizedDiagnostic[] | undefined): ReactNode {
  if (value === undefined || value === null) return <p className="type-compact text-muted-foreground">No data returned.</p>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return <p className="break-words type-compact">{String(value)}</p>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="type-compact text-muted-foreground">No items returned.</p>;
    if (value.every((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      return <ul className="space-y-1">{value.map((item, index) => <li className="break-words type-compact" key={index}>{String(item)}</li>)}</ul>;
    }
    return (
      <div className="overflow-auto border-y border-border-subtle">
        <table className="w-full min-w-[520px] text-left">
          <thead><tr>{tableKeys(value).map((key) => <th className="px-2 py-2 type-table-header text-muted-foreground" key={key}>{labelize(key)}</th>)}</tr></thead>
          <tbody>{value.map((row, index) => <tr className="border-t border-border-subtle" key={index}>{tableKeys(value).map((key) => <td className="max-w-[280px] px-2 py-2 align-top type-compact" key={key}>{cellValue(asRecord(row)?.[key])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  const entries = Object.entries(value).filter(([, item]) => !isEmptyValue(item));
  if (entries.length === 0) return <p className="type-compact text-muted-foreground">No fields returned.</p>;
  return <dl className="grid gap-2">{entries.map(([key, item]) => <div className="grid gap-1 border-b border-border-subtle pb-2 laptop:grid-cols-[180px_minmax(0,1fr)]" key={key}><dt className="type-metadata-label text-muted-foreground">{labelize(key)}</dt><dd className="min-w-0">{Array.isArray(item) || (item && typeof item === "object") ? renderValue(item) : <span className="break-words type-compact">{String(item)}</span>}</dd></div>)}</dl>;
}

function ContextList({ title, values, selected, onSelect, empty }: { title: string; values: string[]; selected: string; onSelect(value: string): void; empty: string }) {
  return (
    <section className="mt-5" aria-label={title}>
      <h2 className="type-metadata-label text-muted-foreground">{title}</h2>
      <div className="mt-2 max-h-44 overflow-auto border-y border-border-subtle py-1">
        {values.map((value) => <button key={value} className={cn("block min-h-8 w-full truncate rounded-control px-2 text-left type-compact hover:bg-hover focus-ring", selected === value && "bg-selection text-foreground")} onClick={() => onSelect(value)}>{value}</button>)}
        {values.length === 0 ? <p className="px-2 py-2 type-compact text-muted-foreground">{empty}</p> : null}
      </div>
    </section>
  );
}

function Selector({ label, value, options, placeholder, onChange }: { label: string; value: string; options: string[]; placeholder?: string; onChange(value: string): void }) {
  return (
    <label className="block max-w-sm">
      <span className="type-metadata-label text-muted-foreground">{label}</span>
      <select className="mt-1 h-10 w-full rounded-control border border-border bg-inset px-3 type-compact focus-ring" value={value} onChange={(event) => onChange(event.target.value)} disabled={options.length === 0}>
        {options.length === 0 ? <option>{placeholder ?? "No options"}</option> : null}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ViewHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header><p className="type-section-eyebrow text-muted-foreground">{eyebrow}</p><h1 id={`${eyebrow.toLowerCase().replace(/\s+/g, "-")}-heading`} className="mt-2 type-section-title">{title}</h1><p className="mt-2 max-w-[72ch] type-compact text-text-secondary">{description}</p></header>;
}

function RepositoryGuardNotice({ reason, metadata }: { reason: string | null; metadata: RepositoryMetadata }) {
  const tone = metadata.status === "failed" ? "danger" : "warning";
  return <div className="p-4"><InlineAlert tone={tone}><p className="type-compact-strong">Gateway calls are paused.</p><p className="mt-1">{reason}</p></InlineAlert></div>;
}

function WorkspaceLoading() {
  return <div role="status" aria-label="Loading repository workspace" className="space-y-4 p-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-32" /><Skeleton className="h-44" /></div>;
}

function SectionTitle({ icon: Icon, title }: { icon: typeof ListTree; title: string }) {
  return <div className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" /><h2 className="type-metadata-label text-muted-foreground">{title}</h2></div>;
}

function DrawerHeader({ title, onClose }: { title: string; onClose(): void }) {
  return <div className="flex h-12 items-center justify-between border-b border-border-subtle px-3"><h2 className="type-panel-title">{title}</h2><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={`Close ${title}`}><X className="size-4" /></Button></div>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><dt className="type-metadata-label text-muted-foreground">{label}</dt><dd className="break-all">{value}</dd></div>;
}

function EvidenceLine({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-border-subtle pb-2"><dt className="type-metadata-label text-muted-foreground">{label}</dt><dd className="break-all type-compact">{value}</dd></div>;
}

function DiagnosticItem({ item }: { item: NormalizedDiagnostic }) {
  return <div className="border-l-2 border-border-subtle pl-3 type-compact"><div className="flex items-center gap-2"><AlertTriangle className="size-3.5 text-warning" /><span className="type-compact-strong">{item.code}</span><span className="text-muted-foreground">{item.severity}</span></div><p className="mt-1 text-text-secondary">{item.message}</p>{item.service ? <p className="mt-1 type-metadata text-muted-foreground">{item.service}</p> : null}</div>;
}

function parseView(value: string | null): WorkspaceView {
  return VIEWS.find((view) => view === value) ?? "overview";
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function featureOptions(overview: RepositoryGatewayOverview | undefined): string[] {
  const values = new Set<string>();
  collectStrings(overview?.features, ["name", "featureId"], values);
  collectStrings(asRecord(overview?.architecture)?.features, ["name", "featureId"], values);
  return [...values].sort();
}

function symbolOptions(overview: RepositoryGatewayOverview | undefined): string[] {
  const values = new Set<string>();
  collectStrings(overview?.symbols, ["qualifiedName", "name", "symbolId"], values);
  collectStrings(asRecord(overview?.symbols)?.publicApis, ["qualifiedName", "name", "symbolId"], values);
  collectStrings(asRecord(overview?.symbols)?.internalApis, ["qualifiedName", "name", "symbolId"], values);
  return [...values].sort();
}

function collectStrings(value: unknown, keys: string[], target: Set<string>) {
  if (typeof value === "string") target.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, keys, target);
  }
  const record = asRecord(value);
  if (!record) return;
  for (const key of keys) {
    if (typeof record[key] === "string") target.add(record[key]);
  }
}

function evidenceFor(input: {
  selectedEvidence: string;
  overview?: RepositoryGatewayOverview;
  diagnostics?: NormalizedDiagnostic[];
  requestId?: string;
  metadata: RepositoryMetadata;
  session?: RepositorySessionDetail;
}): Evidence {
  const overview = input.overview;
  const map: Record<string, Evidence> = {
    architecture: { title: "Architecture", kind: "Metadata", value: overview?.architecture, requestId: input.requestId },
    organization: { title: "Code organization", kind: "Metadata", value: overview?.codeOrganization, requestId: input.requestId },
    quality: { title: "Quality", kind: "Diagnostics", value: overview?.quality, requestId: input.requestId },
    evolution: { title: "Evolution", kind: "Metadata", value: overview?.evolution, requestId: input.requestId },
    metrics: { title: "Statistics", kind: "Metadata", value: overview?.metrics, requestId: input.requestId },
    file: { title: "File evidence", kind: "Files", value: overview?.architecture, requestId: input.requestId },
    files: { title: "Files", kind: "Files", value: overview?.architecture, requestId: input.requestId },
    symbol: { title: "Symbol evidence", kind: "Symbols", value: overview?.symbols, requestId: input.requestId },
    symbols: { title: "Symbols", kind: "Symbols", value: overview?.symbols, requestId: input.requestId },
    feature: { title: "Feature evidence", kind: "Features", value: overview?.features, requestId: input.requestId },
    relationships: { title: "Relationships", kind: "Relationships", value: overview?.architecture, requestId: input.requestId },
    diagnostics: { title: "Diagnostics", kind: "Diagnostics", value: input.diagnostics as unknown as JsonValue, requestId: input.requestId },
    metadata: { title: "Metadata", kind: "Metadata", value: input.metadata as unknown as JsonValue, requestId: input.requestId },
    conversation: { title: "Conversation", kind: "Metadata", value: input.session?.events as unknown as JsonValue, requestId: input.requestId },
    query: { title: "Query evidence", kind: "Metadata", value: input.session?.events.filter((event) => event.kind === "query") as unknown as JsonValue, requestId: input.requestId },
    plan: { title: "Plan evidence", kind: "Metadata", value: input.session?.events.filter((event) => event.kind === "plan") as unknown as JsonValue, requestId: input.requestId },
    specification: { title: "Specification evidence", kind: "Metadata", value: input.session?.events.filter((event) => event.kind === "specification") as unknown as JsonValue, requestId: input.requestId },
    execution: { title: "Execution readiness", kind: "Metadata", value: input.session?.events.filter((event) => event.kind === "execution_summary") as unknown as JsonValue, requestId: input.requestId },
    insights: { title: "Insights", kind: "Metadata", value: input.session?.events.filter((event) => event.kind === "insight") as unknown as JsonValue, requestId: input.requestId },
    outputs: { title: "Engineering outputs", kind: "Metadata", value: input.session?.events.filter((event) => ["plan", "specification", "execution_summary", "insight"].includes(event.kind)) as unknown as JsonValue, requestId: input.requestId },
    workflow: { title: "Workflow", kind: "Metadata", value: input.session?.session as unknown as JsonValue, requestId: input.requestId },
  };
  return map[input.selectedEvidence] ?? map.metadata;
}

function normalizeEntry(entry: DirectoryEntry, parent: string) {
  const name = String(entry.name ?? entry.path ?? entry.relativePath ?? "");
  const path = String(entry.relativePath ?? entry.path ?? (parent ? `${parent}/${name}` : name));
  const type = entry.type === "directory" ? "directory" : "file";
  return { name: name.split("/").pop() ?? name, path, type };
}

function treeKey(event: KeyboardEvent<HTMLButtonElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

function tableKeys(value: unknown[]): string[] {
  const keys = new Set<string>();
  for (const row of value.slice(0, 20)) {
    const record = asRecord(row);
    if (!record) continue;
    for (const key of Object.keys(record).slice(0, 8)) keys.add(key);
  }
  return [...keys];
}

function cellValue(value: JsonValue | undefined): ReactNode {
  if (value === undefined || value === null) return <span className="text-muted-foreground">-</span>;
  if (Array.isArray(value)) return <span>{value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ")}</span>;
  if (typeof value === "object") return <span>{JSON.stringify(value)}</span>;
  return <span className="break-words">{String(value)}</span>;
}

function stringifyEvidence(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function findNestedValue(value: unknown, key: string): JsonValue | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedValue(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (key in record) return record[key] as JsonValue;
  for (const item of Object.values(record)) {
    const found = findNestedValue(item, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function stringField(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function findStringFieldDeep(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringFieldDeep(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as JsonRecord;
  const direct = stringField(record, keys);
  if (direct) return direct;
  for (const item of Object.values(record)) {
    const found = findStringFieldDeep(item, keys);
    if (found) return found;
  }
  return undefined;
}

function findLineRange(value: unknown): { start: string; end: string } | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLineRange(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as JsonRecord;
  const start = record.startLine ?? record.line;
  const end = record.endLine ?? start;
  if (typeof start === "string" || typeof start === "number") {
    return { start: String(start), end: typeof end === "string" || typeof end === "number" ? String(end) : String(start) };
  }
  for (const item of Object.values(record)) {
    const found = findLineRange(item);
    if (found) return found;
  }
  return null;
}

function LoadingRows({ rows }: { rows: number }) {
  return <div role="status" aria-label="Loading rows" className="space-y-2 p-2">{Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-9" />)}</div>;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

function labelize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}
