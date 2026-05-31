// POST /context/build — chunk an already-cloned repository.

import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { buildRepositoryContext } from "../services/context/contextBuilder.js";

const STORAGE_PATH_GUARD = ".storage/repos";

const BuildBody = z.object({ clonePath: z.string().min(1) });

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

  const requestId = randomUUID();
  try {
    const data = await buildRepositoryContext(clonePath);
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

export default contextRouter;
