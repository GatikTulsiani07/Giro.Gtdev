import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon, title, description, action, headingLevel = 2, compact = false }: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  headingLevel?: 2 | 3;
  compact?: boolean;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <div className={cn("mx-auto flex max-w-[480px] flex-col items-center justify-center px-6 text-center", compact ? "min-h-40 py-6" : "min-h-64")}>
      <Icon className="mb-4 size-5 text-muted-foreground" strokeWidth={1.7} />
      <Heading className="type-panel-title">{title}</Heading>
      <p className="mt-2 max-w-sm type-compact text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
