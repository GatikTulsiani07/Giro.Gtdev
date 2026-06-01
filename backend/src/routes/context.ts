// POST /context/build — chunk an already-cloned repository.
// POST /context/assemble — build AI-ready context from embedded chunks.

import { Hono } from "hono";
import { z } from "zod";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildRepositoryContext } from "../services/context/contextBuilder.js";
import { buildContext } from "../services/context/contextAssembler.js";

const STORAGE_PATH_GUARD = ".storage/repos";

const BuildBody = z.object({ clonePath: z.string().min(1) });

const AssembleBody = z.object({
  query: z.string().min(1, "Query must not be empty"),
  maxCharacters: z.number().int().min(500).max(100_000).optional().default(12_000),
});

const contextRouter = new Hono();

contextRouter.post("/build", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = BuildBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Validation failed", details: parsed.error.errors },
      400,
    );
  }

  const { clonePath } = parsed.data;
  if (!clonePath.includes(STORAGE_PATH_GUARD)) {
    return c.json(
      { success: false, error: "Invalid clonePath. Must be within .storage/repos." },
      403,
    );
  }

  // Derive repository identifier from clone folder name (owner--repo)
  const folderName = path.basename(clonePath);
  const repository = folderName.replace("--", "/");

  const requestId = randomUUID();
  try {
    const data = await buildRepositoryContext(clonePath, repository);
    return c.json({ success: true, requestId, data });
  } catch (err) {
    return c.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
        requestId,
      },
      500,
    );
  }
});

contextRouter.post("/assemble", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = AssembleBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Validation failed", details: parsed.error.errors },
      400,
    );
  }

  const requestId = randomUUID();
  try {
    const result = await buildContext(parsed.data.query, parsed.data.maxCharacters);
    return c.json({ success: true, requestId, ...result });
  } catch (err) {
    return c.json(
      {
        success: false,
        requestId,
        error: err instanceof Error ? err.message : "Context assembly failed",
      },
      500,
    );
  }
});

export default contextRouter;
