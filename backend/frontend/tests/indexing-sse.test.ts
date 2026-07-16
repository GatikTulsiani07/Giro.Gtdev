import { describe, expect, it, vi } from "vitest";
import { consumeIndexingStream, parseSseBlock } from "@/services/sse/indexing-events";
import type { IndexingProgress } from "@/types/api";

describe("indexing SSE", () => {
  it("parses named progress events", () => {
    expect(parseSseBlock('event: progress\ndata: {"stage":"embedding"}')).toEqual({ event: "progress", data: '{"stage":"embedding"}' });
  });

  it("delivers progress updates and stops at completion", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode('event: progress\ndata: {"jobId":"job-1","repositoryId":"acme/platform","stage":"embedding","percentage":65,"message":"Embedding","timestamp":"2026-07-17T00:00:00Z"}\n\n'));
      controller.enqueue(encoder.encode('event: completed\ndata: {"jobId":"job-1","repositoryId":"acme/platform","stage":"completed","percentage":100,"message":"Done","timestamp":"2026-07-17T00:01:00Z"}\n\n'));
      controller.close();
    }});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const updates: IndexingProgress[] = [];
    await consumeIndexingStream("acme/platform", "token", { onProgress: (event) => updates.push(event) }, new AbortController().signal);
    expect(updates.map((event) => event.stage)).toEqual(["embedding", "completed"]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("acme%2Fplatform/indexing/events"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token" }) }));
  });
});
