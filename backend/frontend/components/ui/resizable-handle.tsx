import { PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/lib/utils";

export function ResizableHandle({ className }: { className?: string }) {
  return <PanelResizeHandle className={cn("relative w-3 bg-background outline-none after:absolute after:bottom-0 after:left-1/2 after:top-0 after:w-px after:bg-border-subtle hover:after:bg-border focus-visible:after:w-0.5 focus-visible:after:bg-border-focus", className)} />;
}
