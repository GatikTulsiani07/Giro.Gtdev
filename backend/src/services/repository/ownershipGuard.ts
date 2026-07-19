// Repository access authorization. Returns a discriminated result; never throws.

import { getRepositoryOwner } from "./ownershipStore.js";
import { mapMaybePromise, type MaybePromise } from "../../lib/maybePromise.js";

export type RepositoryAccessResult =
  | { ok: true }
  | { ok: false; status: 403 | 404; code: string; message: string };

export function requireRepositoryAccess(input: {
  repoId: string;
  userId: string;
}): RepositoryAccessResult;
export function requireRepositoryAccess(input: {
  repoId: string;
  userId: string;
}): MaybePromise<RepositoryAccessResult> {
  return mapMaybePromise(getRepositoryOwner(input.repoId), (ownerUserId) => {
    // Unknown ownership -> reuse the existing not-connected response style.
    if (ownerUserId === undefined) {
      return {
        ok: false,
        status: 404,
        code: "repo_not_connected",
        message: "Repository not connected. Call POST /repos/connect first.",
      };
    }

    // Known owner but a different user -> forbidden.
    if (ownerUserId !== input.userId) {
      return {
        ok: false,
        status: 403,
        code: "repo_not_owned",
        message: "You do not have access to this repository.",
      };
    }

    return { ok: true };
  });
}
