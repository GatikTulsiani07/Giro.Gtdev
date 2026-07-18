import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-64 max-w-[480px] flex-col items-center justify-center px-6 text-center">
      <Icon className="mb-4 size-5 text-muted-foreground" strokeWidth={1.7} />
      <h2 className="type-panel-title">{title}</h2>
      <p className="mt-2 max-w-sm type-compact text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
