// Mounts all route modules onto a single Hono router.

import { Hono } from "hono";
import { rootRoute } from "./root.js";
import { healthRoute } from "./health.js";
import { repositoriesRoute } from "./repositories.js";

export const routes = new Hono();

routes.route("/", rootRoute);
routes.route("/", healthRoute);
routes.route("/repos", repositoriesRoute);
