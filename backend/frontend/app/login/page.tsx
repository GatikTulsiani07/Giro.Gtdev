import type { Metadata } from "next";
import { GitBranch, ScanSearch, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1.15fr_0.85fr]">
      <section className="hidden border-r border-border bg-panel p-12 lg:flex lg:flex-col lg:justify-between">
        <Logo />
        <div className="max-w-xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-primary">Repository intelligence</p>
          <h1 className="mt-5 text-balance font-display text-6xl italic leading-[0.96] tracking-[-0.035em] text-foreground">Understand the codebase behind every answer.</h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">Giro connects retrieval, repository structure, citations, and confidence into one engineering workspace.</p>
          <div className="mt-10 grid grid-cols-3 gap-3">
            {[{ icon: GitBranch, label: "Repository aware" }, { icon: ScanSearch, label: "Inspect retrieval" }, { icon: ShieldCheck, label: "Grounded evidence" }].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-xl border border-border bg-card/70 p-4"><Icon className="size-4 text-primary" /><p className="mt-8 text-xs text-muted-foreground">{label}</p></div>
            ))}
          </div>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Giro / engineering context</p>
      </section>
      <section className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-12 lg:hidden"><Logo /></div>
          <h2 className="font-display text-4xl italic tracking-tight text-foreground">Welcome to Giro</h2>
          <p className="mt-2 text-sm text-muted-foreground">Sign in with an access token issued by your Giro deployment.</p>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}

function Logo() {
  return <div className="flex items-center gap-2.5"><span className="font-display text-3xl italic leading-none text-foreground">G</span><span className="font-display text-xl text-foreground">Giro</span><span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[9px] tracking-wider text-primary">DEV</span></div>;
}
