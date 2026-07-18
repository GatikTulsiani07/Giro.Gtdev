"use client";

import { Highlight, type PrismTheme } from "prism-react-renderer";
import { CopyControl } from "./copy-control";

const giroCodeTheme: PrismTheme = {
  plain: { color: "hsl(var(--code-text))", backgroundColor: "hsl(var(--code-background))" },
  styles: [
    { types: ["comment", "prolog", "doctype"], style: { color: "hsl(var(--text-muted))" } },
    { types: ["punctuation", "operator"], style: { color: "hsl(var(--text-secondary))" } },
    { types: ["keyword", "boolean", "constant"], style: { color: "hsl(var(--status-info))" } },
    { types: ["function", "class-name", "tag"], style: { color: "hsl(var(--status-warning))" } },
    { types: ["string", "attr-value"], style: { color: "hsl(var(--status-success))" } },
    { types: ["number", "symbol"], style: { color: "hsl(var(--border-focus))" } },
  ],
};

export function CodeBlock({ source, language = "text", label }: { source: string; language?: string; label?: string }) {
  return <div className="my-4 overflow-hidden rounded-panel bg-code"><div className="flex h-10 items-center justify-between border-b border-border-subtle px-3"><span className="min-w-0 truncate type-metadata-label text-muted-foreground">{label ?? language}</span><CopyControl value={source} label={`Copy ${label ?? language}`} /></div><Highlight theme={giroCodeTheme} code={source} language={language}>{({ tokens, getLineProps, getTokenProps }) => <pre className="overflow-auto p-4 type-mono text-code-foreground">{tokens.map((line, index) => <div key={index} {...getLineProps({ line })} className="table-row"><span className="table-cell select-none pr-4 text-right type-metadata text-muted-foreground">{index + 1}</span><span className="table-cell">{line.map((token, tokenIndex) => <span key={tokenIndex} {...getTokenProps({ token })} />)}</span></div>)}</pre>}</Highlight></div>;
}
