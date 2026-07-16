import { Hono } from "hono";
import { z } from "zod";
import { semanticSearchWithCitations } from "../services/embeddings/search.js";
import { getRequestDeadline } from "../middleware/requestTimeout.js";
import { isDeadlineExceeded } from "../runtime/deadline.js";
import { isDependencyUnavailable } from "../runtime/circuitBreaker.js";
import type { RetrievalCache } from "../services/retrieval/cache/retrievalCache.js";

const SearchBody = z.object({
  query: z.string().min(1, "Query must not be empty"),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

const searchRouter = new Hono<{
  Variables: { requestId: string; retrievalCache: RetrievalCache };
}>();

searchRouter.post("/context", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SearchBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Validation failed", details: parsed.error.errors },
      400,
    );
  }

  const requestId = c.get("requestId");
  try {
    const signal = getRequestDeadline(c)?.signal;
    const { results, citations } = await semanticSearchWithCitations(
      parsed.data.query,
      parsed.data.limit,
      {
        signal,
        repositoryVersion: (repositoryId, versionSignal) =>
          c.get("retrievalCache").repositoryVersion(repositoryId, versionSignal),
      },
    );
    return c.json({ success: true, requestId, count: results.length, results, citations });
  } catch (err) {
    if (isDeadlineExceeded(err) || isDependencyUnavailable(err)) throw err;
    return c.json(
      {
        success: false,
        requestId,
        error: err instanceof Error ? err.message : "Search failed",
      },
      500,
    );
  }
});

export default searchRouter;
