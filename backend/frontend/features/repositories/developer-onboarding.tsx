"use client";

import Link from "next/link";
import { ArrowRight, Braces, FileCode2, GitBranch, Layers, MessageSquare, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const demoRepository = {
  owner: "giro-demo",
  repo: "sample-platform",
  session: "demo-session",
  feature: "Authentication",
  architecture: ["Web application", "Repository gateway client", "Session workspace", "Evidence panel"],
};

const onboardingSteps = [
  { icon: GitBranch, title: "Connect Repository", detail: "Add a GitHub repository so Giro can track repository status and indexing progress.", action: "Connect repository", href: "/repositories/connect" },
  { icon: FileCode2, title: "Wait for Index", detail: "Watch queued and indexing repositories until the backend marks repository intelligence as ready.", action: "View indexing progress", href: `/repositories/${demoRepository.owner}/${demoRepository.repo}/indexing` },
  { icon: Layers, title: "Open Workspace", detail: "Open the repository workspace to inspect structure, files, evidence, and diagnostics.", action: "Open demo workspace", href: `/repositories/${demoRepository.owner}/${demoRepository.repo}` },
  { icon: Search, title: "Ask First Question", detail: "Use repository-grounded context before asking an engineering question.", action: "Search evidence", href: `/repositories/${demoRepository.owner}/${demoRepository.repo}/search` },
  { icon: MessageSquare, title: "Create First Session", detail: "Start a persistent engineering session when repository intelligence is ready.", action: "Open demo session", href: `/chat/${demoRepository.session}` },
  { icon: Braces, title: "Explore Architecture", detail: "Review layers, packages, features, symbols, dependencies, and evidence returned by existing APIs.", action: "Explore architecture", href: `/repositories/${demoRepository.owner}/${demoRepository.repo}?view=architecture&feature=${encodeURIComponent(demoRepository.feature)}` },
] as const;

export function DeveloperOnboarding({ compact = false }: { compact?: boolean }) {
  return (
    <section aria-labelledby="developer-onboarding-heading" className={compact ? "mt-8" : "mt-10"}>
      <div className="grid items-start gap-8 laptop:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <p className="type-section-eyebrow text-muted-foreground">Developer onboarding</p>
          <h2 id="developer-onboarding-heading" className="mt-2 type-section-title">First run checklist</h2>
          <p className="mt-3 max-w-[68ch] type-body text-text-secondary">Follow this path the first time you run Giro locally: connect a repository, wait for indexing, open the workspace, ask a grounded question, create a session, and inspect architecture.</p>
          <ol aria-label="Developer onboarding steps" className="mt-5 divide-y divide-border-subtle border-y border-border-subtle">
            {onboardingSteps.map(({ icon: Icon, title, detail, action, href }, index) => (
              <li key={title} className="grid gap-3 px-3 py-4 mobile:grid-cols-[32px_28px_minmax(0,1fr)_auto] mobile:items-center">
                <span className="type-metadata text-muted-foreground">0{index + 1}</span>
                <Icon className={index === 0 ? "size-4 text-primary" : "size-4 text-muted-foreground"} aria-hidden="true" />
                <div className="min-w-0">
                  <h3 className="type-compact-strong">{title}</h3>
                  <p className="mt-1 type-compact text-muted-foreground">{detail}</p>
                </div>
                <Link href={href} className="inline-flex min-h-9 items-center gap-1 rounded-control px-2 type-compact-strong text-primary hover:bg-hover focus-ring">
                  {action}<ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        </div>
        <DemoRepositoryCard />
      </div>
    </section>
  );
}

function DemoRepositoryCard() {
  return (
    <aside aria-label="Demo repository walkthrough" className="rounded-control border border-border-subtle bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-section-eyebrow text-muted-foreground">Sample repository</p>
          <h3 className="mt-2 truncate type-panel-title">{demoRepository.owner}/{demoRepository.repo}</h3>
        </div>
        <StatusBadge label="Demo" tone="info" />
      </div>
      <p className="mt-3 type-compact text-text-secondary">A predefined walkthrough for learning Giro’s repository workspace without adding mock backend data.</p>
      <dl className="mt-4 grid gap-2 type-compact">
        <div><dt className="type-metadata-label text-muted-foreground">Demo session</dt><dd>{demoRepository.session}</dd></div>
        <div><dt className="type-metadata-label text-muted-foreground">Demo feature</dt><dd>{demoRepository.feature}</dd></div>
        <div><dt className="type-metadata-label text-muted-foreground">Architecture areas</dt><dd>{demoRepository.architecture.join(", ")}</dd></div>
      </dl>
      <div className="mt-4 grid gap-2">
        <Button asChild variant="secondary" className="justify-start"><Link href={`/repositories/${demoRepository.owner}/${demoRepository.repo}`}><Play className="size-4" />Open walkthrough</Link></Button>
        <Button asChild variant="ghost" className="justify-start"><Link href={`/chat/${demoRepository.session}`}><MessageSquare className="size-4" />Review demo session</Link></Button>
      </div>
    </aside>
  );
}
