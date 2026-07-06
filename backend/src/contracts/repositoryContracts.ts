import { z } from "zod";

const REPOSITORY_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/;

const RepositorySegmentSchema = z
  .string()
  .trim()
  .min(1, "repository value is required")
  .regex(REPOSITORY_SEGMENT_PATTERN, "repository value contains invalid characters");

export const RepositoryOwnerSchema = RepositorySegmentSchema;

export const RepositoryNameSchema = RepositorySegmentSchema;

export const RepositoryIdentifierSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parts = value.split("/");
    if (parts.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "repository identifier must be 'owner/repo'",
      });
      return z.NEVER;
    }

    const [ownerRaw, repoRaw] = parts as [string, string];
    const parsed = z
      .object({
        owner: RepositoryOwnerSchema,
        repo: RepositoryNameSchema,
      })
      .safeParse({ owner: ownerRaw, repo: repoRaw });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue(issue);
      }
      return z.NEVER;
    }

    return parsed.data;
  });

export const RepositoryConnectRequestSchema = z.object({
  repoUrl: z.string().trim().min(1, "repoUrl is required"),
});

export const RepositoryCleanupRequestSchema = z.object({
  owner: RepositoryOwnerSchema,
  repo: RepositoryNameSchema,
});

export const RepositoryWorkspaceParamsSchema = z.object({
  owner: RepositoryOwnerSchema,
  repo: RepositoryNameSchema,
});

export const RepositoryDashboardParamsSchema = z.object({
  owner: RepositoryOwnerSchema,
  repo: RepositoryNameSchema,
});

export function parseRepositoryIdentifier(
  identifier: string,
): z.infer<typeof RepositoryIdentifierSchema> {
  return RepositoryIdentifierSchema.parse(identifier);
}

export function validateRepositoryOwner(owner: string): string {
  return RepositoryOwnerSchema.parse(owner);
}

export function validateRepositoryName(repo: string): string {
  return RepositoryNameSchema.parse(repo);
}
