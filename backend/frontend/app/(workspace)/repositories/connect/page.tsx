import type { Metadata } from "next";
import { Database, GitBranch, ScanSearch } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ConnectRepositoryForm } from "@/features/repositories/connect-repository-form";

export const metadata: Metadata = { title: "Connect repository" };
export default function ConnectRepositoryPage() {
  return <div className="mx-auto max-w-3xl p-4 sm:p-8 lg:pt-16"><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">New repository</p><h1 className="mt-3 font-display text-5xl italic tracking-tight">Connect a codebase</h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">Giro indexes repository structure and retrieval metadata so every answer can point back to real evidence.</p><Card className="mt-8 p-5 sm:p-7"><ConnectRepositoryForm /></Card><div className="mt-6 grid gap-3 sm:grid-cols-3">{[{ icon: GitBranch, label: "Clone", text: "Connect through the existing backend workflow." }, { icon: Database, label: "Index", text: "Build chunks, symbols, graph, and embeddings." }, { icon: ScanSearch, label: "Explore", text: "Ask questions with grounded citations." }].map(({ icon: Icon, label, text }) => <div key={label} className="rounded-xl border border-border bg-card/40 p-4"><Icon className="size-4 text-primary" /><p className="mt-4 text-sm font-medium">{label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p></div>)}</div></div>;
}
