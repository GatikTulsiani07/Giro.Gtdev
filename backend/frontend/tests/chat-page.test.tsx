import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/features/chat/chat-panel";
import { ConversationHistory } from "@/features/chat/conversation-history";
import { citation, session } from "./fixtures";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat/session-1" }));

describe("chat page", () => {
  it("renders its empty state and submits a question", () => {
    const onAsk = vi.fn();
    render(<ChatPanel session={session} latestAnswer={null} pendingQuestion={null} asking={false} error={null} onAsk={onAsk} />);
    expect(screen.getByText("Explore platform")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ask a repository question"), { target: { value: "Where is auth handled?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(onAsk).toHaveBeenCalledWith("Where is auth handled?");
  });

  it("renders loading state while grounded retrieval runs", () => {
    render(<ChatPanel session={session} latestAnswer={null} pendingQuestion="Explain auth" asking error={null} onAsk={vi.fn()} />);
    expect(screen.getByText("Retrieving repository evidence…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  });

  it("renders answer confidence, timing, version, and citations", () => {
    const answered = { ...session, messages: [{ id: "a-1", role: "assistant" as const, content: "Authentication is handled by `authenticate`.", citations: [citation], createdAt: "2026-07-17T00:00:00Z" }] };
    render(<ChatPanel session={answered} latestAnswer={{ durationMs: 1250, result: { answer: "Authentication is handled.", sources: [], citations: [citation], metadata: { retrievedFiles: 1, usedSummary: false, usedDependencyGraph: true, retrievalSourceCounts: { semantic: 1, keyword: 0, symbol: 1, graph: 1, fileSearch: 0 }, estimatedContextTokens: 400, confidence: { level: "high", score: 0.91, answerable: true, reasons: ["strong_top_match"] } } } }} pendingQuestion={null} asking={false} error={null} onAsk={vi.fn()} />);
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("1.3 s")).toBeInTheDocument();
    expect(screen.getByText("version job-1:1")).toBeInTheDocument();
    expect(screen.getByText("src/auth/login.ts")).toBeInTheDocument();
  });

  it("supports switching sessions through conversation history", () => {
    const second = { ...session, id: "session-2", title: "Second session" };
    render(<ConversationHistory sessions={[session, second]} activeId="session-1" onCreate={vi.fn()} creating={false} />);
    expect(screen.getByRole("link", { name: /Second session/ })).toHaveAttribute("href", "/chat/session-2");
  });
});
