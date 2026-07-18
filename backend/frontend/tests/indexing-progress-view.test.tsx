import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexingProgressView } from "@/features/indexing/indexing-progress-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/use-indexing-progress", () => ({
  useIndexingProgress: () => ({
    progress: { jobId: "job-1", repositoryId: "acme/platform", stage: "failed", percentage: 32, message: "Clone failed", timestamp: "2026-07-18T00:00:00Z" },
    connected: false,
    disconnected: true,
    reconnecting: false,
    streamError: null,
    retry: vi.fn(),
  }),
}));

describe("indexing progress presentation", () => {
  it("announces failure and marks the active timeline stage failed", () => {
    render(<IndexingProgressView owner="acme" repo="platform" jobId="job-1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Indexing Failed, 32 percent. Clone failed");
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(within(screen.getByText("Queued").closest("li") as HTMLElement).getByText("Failed")).toBeInTheDocument();
  });
});
