import type { Metadata } from "next";
import { ChatWorkspace } from "@/features/chat/chat-workspace";

export const metadata: Metadata = { title: "Repository session" };
export default async function ChatPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <div className="h-full min-h-0"><ChatWorkspace sessionId={decodeURIComponent(sessionId)} /></div>;
}
