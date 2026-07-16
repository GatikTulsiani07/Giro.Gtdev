"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, themes } from "prism-react-renderer";

export function MarkdownMessage({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className="space-y-3 text-sm leading-7 text-foreground [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:leading-7 [&_ul]:list-disc"
      components={{
        code({ className, children: codeChildren, ...props }) {
          const match = /language-(\w+)/.exec(className ?? "");
          const source = String(codeChildren).replace(/\n$/, "");
          if (!match) return <code className="rounded bg-foreground/[0.07] px-1.5 py-0.5 font-mono text-xs text-primary" {...props}>{codeChildren}</code>;
          return (
            <Highlight theme={themes.vsDark} code={source} language={match[1] ?? "text"}>
              {({ tokens, getLineProps, getTokenProps }) => (
                <pre className="overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-6">
                  {tokens.map((line, index) => (
                    <div key={index} {...getLineProps({ line })}>
                      {line.map((token, tokenIndex) => <span key={tokenIndex} {...getTokenProps({ token })} />)}
                    </div>
                  ))}
                </pre>
              )}
            </Highlight>
          );
        },
      }}
    >{children}</ReactMarkdown>
  );
}
