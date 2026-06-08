// Mounts all route modules onto a single Hono router.

import { Hono } from "hono";
import { rootRoute } from "./root.js";
import { healthRoute } from "./health.js";
import { repositoriesRoute } from "./repositories.js";
import contextRouter from "./context.js";
import searchRouter from "./search.js";
import chatRouter from "./chat.js";
import toolsRouter from "./tools.js";
import retrievalRouter from "./retrieval.js";
import sessionsRouter from "./sessions.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

export const routes = new Hono();

// Public routes — no authentication required.
routes.route("/", rootRoute);
routes.route("/", healthRoute);

// Require a valid Bearer token for all protected route groups. Scoped to
// explicit prefixes (never a catch-all) so root + health stay public.
routes.use("/repos/*", authMiddleware());
routes.use("/context/*", authMiddleware());
routes.use("/search/*", authMiddleware());
routes.use("/chat/*", authMiddleware());
routes.use("/tools/*", authMiddleware());
routes.use("/retrieval/*", authMiddleware());
routes.use("/sessions/*", authMiddleware());

// Protected routes.
routes.route("/repos", repositoriesRoute);
routes.route("/context", contextRouter);
routes.route("/search", searchRouter);
routes.route("/chat", chatRouter);
routes.route("/tools", toolsRouter);
routes.route("/retrieval", retrievalRouter);
routes.route("/sessions", sessionsRouter);
