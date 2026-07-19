import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Braces, Database, FileCode2, GitBranch, MessageSquare, ShieldCheck } from "lucide-react";
import { PlatformShowcase } from "@/components/marketing/platform-showcase";
import { PublicBrand } from "@/components/marketing/public-brand";
import { PublicHeader } from "@/components/marketing/public-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Repository intelligence for engineering work",
  description: "Search indexed repository evidence, inspect engineering context, and ask repository-scoped questions with Giro.",
};

const currentCapabilities = [
  "Repository summaries and detected technology",
  "Files, symbols, modules, and dependency context",
  "Ranked evidence with line ranges and scores",
  "Repository-scoped sessions with citations",
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <main>
        <section className="mx-auto grid min-h-[640px] w-full max-w-[1280px] items-center gap-14 px-12 py-24 laptop:grid-cols-[minmax(0,1fr)_320px] max-[1080px]:px-8 max-[820px]:min-h-0 max-[820px]:px-4 max-[820px]:py-16">
          <div className="min-w-0">
            <p className="type-section-eyebrow text-muted-foreground">Repository intelligence for engineering teams</p>
            <h1 className="mt-5 max-w-[900px] text-balance font-display text-[72px] font-normal leading-[0.96] text-foreground max-[1080px]:text-[60px] max-[820px]:text-[46px]">Understand the repository <span className="italic text-primary">before changing it</span><span className="not-italic">.</span></h1>
            <p className="mt-7 max-w-[760px] text-balance font-sans text-lg leading-7 text-text-secondary max-[820px]:text-base max-[820px]:leading-6">Giro indexes repository context so engineers can review summaries, search ranked evidence, and ask repository-scoped questions with inspectable citations.</p>
            <div className="mt-8 flex flex-wrap gap-3"><Button asChild variant="accent" size="lg"><Link href="/login">Sign in to Giro<ArrowRight className="size-4" /></Link></Button><Button asChild variant="secondary" size="lg"><Link href="#evidence">See how evidence is presented</Link></Button></div>
          </div>
          <aside aria-label="Currently available in Giro Web" className="border-y border-border-subtle py-5">
            <p className="type-metadata-label text-muted-foreground">Available in Giro Web</p>
            <div className="mt-3 divide-y divide-border-subtle">{currentCapabilities.map((capability, index) => <div key={capability} className="flex min-h-12 items-center gap-3 py-3"><span className={index === 0 ? "type-metadata text-primary" : "type-metadata text-muted-foreground"}>0{index + 1}</span><p className="type-compact text-text-secondary">{capability}</p></div>)}</div>
          </aside>
        </section>

        <PlatformShowcase />

        <section className="mx-auto grid w-full max-w-[1280px] items-center gap-16 px-12 py-32 laptop:grid-cols-[minmax(0,0.8fr)_minmax(480px,1.2fr)] max-[1080px]:px-8 max-[820px]:gap-10 max-[820px]:px-4 max-[820px]:py-20">
          <div>
            <p className="type-section-eyebrow text-muted-foreground">Repository workflow</p>
            <h2 className="mt-4 text-balance font-display text-[48px] leading-[0.98] max-[820px]:text-[38px]">Move from repository identity to engineering context.</h2>
            <p className="mt-6 max-w-[58ch] type-body text-text-secondary">After indexing, Giro presents the repository purpose, detected technologies, entry points, important paths, modules, health information, and suggested places to continue exploring.</p>
            <p className="mt-4 max-w-[58ch] type-compact text-muted-foreground">The available analysis depends on what the current repository index exposes. Giro does not claim complete static analysis.</p>
          </div>
          <EngineeringContextPanel />
        </section>

        <section id="evidence" className="border-y border-border-subtle bg-panel">
          <div className="mx-auto grid w-full max-w-[1280px] items-center gap-16 px-12 py-28 laptop:grid-cols-[minmax(0,0.8fr)_minmax(480px,1.2fr)] max-[1080px]:px-8 max-[820px]:gap-10 max-[820px]:px-4 max-[820px]:py-20">
            <div>
              <p className="type-section-eyebrow text-muted-foreground">Inspectable evidence</p>
              <h2 className="mt-4 text-balance font-display text-[48px] leading-[0.98] max-[820px]:text-[38px]">Trace an answer back to indexed repository context.</h2>
              <p className="mt-6 max-w-[58ch] type-body text-text-secondary">Search results and citations can expose source identity, line ranges, symbols, retrieval type, scores, repository version, and an evidence excerpt when that data is available.</p>
              <p className="mt-4 max-w-[58ch] type-compact text-muted-foreground">Source URLs are not currently exposed by the backend. Giro presents indexed evidence; it does not provide live source browsing.</p>
            </div>
            <EvidencePanel />
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-[1280px] items-center gap-16 px-12 py-28 laptop:grid-cols-[minmax(0,0.8fr)_minmax(480px,1.2fr)] max-[1080px]:px-8 max-[820px]:gap-10 max-[820px]:px-4 max-[820px]:py-20">
          <div>
            <p className="type-section-eyebrow text-muted-foreground">Deployment configuration</p>
            <h2 className="mt-4 text-balance font-display text-[48px] leading-[0.98] max-[820px]:text-[38px]">Use the model configured by your Giro deployment.</h2>
            <p className="mt-6 max-w-[58ch] type-body text-text-secondary">The current backend implements OpenAI chat completions and can use OpenAI embeddings. The chat model is selected through deployment configuration.</p>
            <p className="mt-4 max-w-[58ch] type-compact text-muted-foreground">Anthropic models—including Claude Opus—and “Fable 5” are not implemented in the current repository, so Giro does not advertise them as available.</p>
          </div>
          <ModelConfigurationPanel />
        </section>

        <section className="mx-auto w-full max-w-[1280px] px-12 pb-24 max-[1080px]:px-8 max-[820px]:px-4 max-[820px]:pb-16">
          <div className="rounded-panel border border-primary bg-selection px-8 py-20 text-center max-[820px]:px-5 max-[820px]:py-14">
            <p className="type-section-eyebrow text-primary">Giro Web is available</p>
            <h2 className="mx-auto mt-5 max-w-[760px] text-balance font-display text-[56px] leading-none max-[820px]:text-[42px]">Open an indexed repository with the context attached.</h2>
            <p className="mx-auto mt-5 max-w-[620px] type-body text-text-secondary">Sign in with the access token issued by your Giro deployment. Authentication is validated before the engineering workspace opens.</p>
            <div className="mt-8"><Button asChild variant="accent" size="lg"><Link href="/login">Sign in to Giro<ArrowRight className="size-4" /></Link></Button></div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border-subtle"><div className="mx-auto flex min-h-24 w-full max-w-[1280px] flex-wrap items-center justify-between gap-4 px-12 max-[1080px]:px-8 max-[820px]:px-4"><PublicBrand /><p className="type-metadata text-muted-foreground">REPOSITORY INTELLIGENCE · WEB AVAILABLE</p></div></footer>
    </div>
  );
}

function EngineeringContextPanel() {
  const items = [
    { icon: GitBranch, label: "Repository identity", value: "Owner · repository · indexed revision" },
    { icon: FileCode2, label: "Engineering summary", value: "Purpose · technology · entry points" },
    { icon: Braces, label: "Exploration", value: "Files · symbols · modules · dependencies" },
    { icon: MessageSquare, label: "Continue working", value: "Search · sessions · Ask Giro" },
  ];
  return <div className="rounded-panel border border-border bg-panel p-6 shadow-raised max-[820px]:p-4"><div className="flex items-center gap-3 border-b border-border-subtle pb-4"><span className="grid size-8 place-items-center rounded-control bg-selection"><Database className="size-4 text-primary" /></span><div><p className="type-panel-title">Repository overview</p><p className="type-metadata text-success">INDEX READY</p></div></div><div className="mt-4 divide-y divide-border-subtle border-y border-border-subtle">{items.map(({ icon: Icon, label, value }, index) => <div key={label} className="grid gap-3 px-3 py-4 mobile:grid-cols-[28px_150px_minmax(0,1fr)]"><span className="type-metadata text-muted-foreground">0{index + 1}</span><span className="flex items-center gap-2 type-compact-strong"><Icon className="size-3.5 text-primary" />{label}</span><span className="type-compact text-muted-foreground">{value}</span></div>)}</div></div>;
}

function EvidencePanel() {
  return <div className="overflow-hidden rounded-panel border border-border bg-background shadow-raised"><div className="flex items-center gap-3 border-b border-border-subtle px-5 py-4"><ShieldCheck className="size-4 text-primary" /><div><p className="type-panel-title">Evidence anatomy</p><p className="type-metadata text-muted-foreground">FIELDS EXPOSED BY CURRENT CONTRACTS</p></div></div><div className="grid laptop:grid-cols-[180px_minmax(0,1fr)]"><div className="border-b border-border-subtle p-4 laptop:border-b-0 laptop:border-r"><p className="type-metadata-label text-muted-foreground">Source identity</p><dl className="mt-4 space-y-4"><EvidenceField label="File" value="relative file path" /><EvidenceField label="Lines" value="start–end" /><EvidenceField label="Symbol" value="when available" /><EvidenceField label="Version" value="indexed revision" /></dl></div><div className="min-w-0 p-5"><div className="flex flex-wrap items-center gap-2"><span className="rounded-badge bg-inset px-2 py-1 type-metadata text-muted-foreground">LANGUAGE</span><span className="rounded-badge bg-inset px-2 py-1 type-metadata text-muted-foreground">RETRIEVAL TYPE</span><span className="rounded-badge bg-selection px-2 py-1 type-metadata text-primary">SCORE 0–1</span></div><pre className="mt-5 overflow-x-auto rounded-control bg-code p-4 type-mono text-code-foreground"><code>{"// Evidence excerpt when available\nfunction inspectRepositoryContext() {\n  return { filePath, startLine, endLine, score };\n}"}</code></pre><p className="mt-4 type-compact text-muted-foreground">The preview above illustrates contract fields, not a live retrieval result.</p></div></div></div>;
}

function EvidenceField({ label, value }: { label: string; value: string }) {
  return <div><dt className="type-metadata-label text-muted-foreground">{label}</dt><dd className="mt-1 type-mono text-foreground">{value}</dd></div>;
}

function ModelConfigurationPanel() {
  const rows = [
    ["Chat provider", "OpenAI"],
    ["Chat model", "Deployment-configured"],
    ["Default model", "gpt-4.1-mini"],
    ["OpenAI embedding model", "text-embedding-3-small"],
    ["Development embedding option", "Deterministic mock"],
  ];
  return <div className="rounded-panel border border-border bg-panel p-6 shadow-raised max-[820px]:p-4"><div className="flex items-center gap-3 border-b border-border-subtle pb-4"><span className="grid size-8 place-items-center rounded-control bg-selection"><Braces className="size-4 text-primary" /></span><div><p className="type-panel-title">Current provider implementation</p><p className="type-metadata text-muted-foreground">BACKEND CONFIGURATION</p></div></div><dl className="mt-4 divide-y divide-border-subtle border-y border-border-subtle">{rows.map(([label, value]) => <div key={label} className="flex min-h-12 items-center gap-4 py-3"><dt className="type-compact text-muted-foreground">{label}</dt><dd className="ml-auto text-right type-mono text-foreground">{value}</dd></div>)}</dl></div>;
}
