import type { Metadata } from "next";
import { Panel } from "@/components/ui/card";
import { ConnectRepositoryForm } from "@/features/repositories/connect-repository-form";

export const metadata: Metadata = { title: "Connect repository" };
export default function ConnectRepositoryPage() {
  return <div className="layout-editorial layout-gutter py-10 max-[820px]:py-8"><p className="type-section-eyebrow text-muted-foreground">New repository</p><h1 className="mt-2 type-page-title">Connect <span className="italic text-primary">repository</span><span className="not-italic">.</span></h1><p className="mt-2 max-w-[68ch] type-body text-text-secondary">Giro connects to a GitHub repository with the permissions already configured by your backend, then builds repository intelligence for grounded answers.</p><Panel className="mt-7 border border-border-subtle"><div><h2 className="type-panel-title">Repository source</h2><p className="mt-1 type-compact text-muted-foreground">Enter one complete GitHub repository URL. Giro will reuse a healthy existing index when available.</p></div><ConnectRepositoryForm /></Panel><p className="mt-4 type-compact text-muted-foreground">Indexing runs asynchronously. You can leave the progress screen and return later without interrupting the job.</p></div>;
}
