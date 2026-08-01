import { Hono, type Context } from "hono";
import { z } from "zod";
import { fail, ok } from "../lib/response.js";
import { createValidationError } from "../lib/apiErrors.js";
import { setRequestLogContext } from "../middleware/requestContext.js";
import { requireAuthenticatedUser } from "../services/auth/authContext.js";
import {
  RepositoryMetadataApiSchemas,
  RepositoryMetadataContractError,
} from "../services/repositoryMetadataApi/contracts.js";
import {
  runtimeRepositoryMetadataApiService,
  type RepositoryMetadataApiService,
} from "../services/repositoryMetadataApi/service.js";

export function createRepositoryMetadataApiRoute(options: {
  service?: RepositoryMetadataApiService;
} = {}) {
  const service = options.service ?? runtimeRepositoryMetadataApiService;
  const route = new Hono();

  const failure = (c: Context, error: unknown) => {
    if (error instanceof z.ZodError) {
      return fail(c, createValidationError(error.flatten()), 400);
    }
    if (error instanceof RepositoryMetadataContractError) {
      return fail(c, {
        code: error.code,
        message: "Stored repository metadata is not gateway compatible.",
        details: { field: error.field },
      }, 500);
    }
    return fail(c, {
      code: "repository_metadata_unavailable",
      message: "Repository metadata is unavailable.",
    }, 503);
  };

  route.get("/", async (c) => {
    try {
      const user = requireAuthenticatedUser(c);
      setRequestLogContext(c, { operation: "repository_metadata.list" });
      const repositories = await service.list(user.userId);
      return ok(c, { repositories, count: repositories.length });
    } catch (error) {
      return failure(c, error);
    }
  });

  route.get("/:owner/:repo", async (c) => {
    try {
      const user = requireAuthenticatedUser(c);
      const params = RepositoryMetadataApiSchemas.params.parse({
        owner: c.req.param("owner"),
        repo: c.req.param("repo"),
      });
      const repositoryId = `${params.owner}/${params.repo}`;
      setRequestLogContext(c, {
        repositoryId,
        operation: "repository_metadata.lookup",
      });
      const result = await service.get(user.userId, repositoryId);
      if (!result.ok) {
        return fail(c, {
          code: result.code,
          message: result.message,
        }, result.status);
      }
      return ok(c, { repository: result.repository });
    } catch (error) {
      if (error instanceof z.ZodError) service.recordFailure();
      return failure(c, error);
    }
  });

  return route;
}
