import { repositoryGatewayClient } from "./gateway";
import { standardApiClient } from "./client";
import type {
  DirectoryEntry,
  FeatureNavigationOperation,
  FeatureNavigationPayload,
  FileReadResult,
  FileTreeNode,
  RepositoryGatewayOverview,
  SemanticNavigationOperation,
  SemanticNavigationPayload,
} from "@/types/api";

function repositoryPath(owner: string, repo: string): string {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export const repositoryWorkspaceApi = {
  overview(token: string, owner: string, repo: string, revision: string, signal?: AbortSignal) {
    return repositoryGatewayClient.get<RepositoryGatewayOverview>(
      `/api/v1/repository-gateway/${repositoryPath(owner, repo)}/overview?revision=${encodeURIComponent(revision)}`,
      token,
      signal,
    );
  },
  feature(
    token: string,
    owner: string,
    repo: string,
    revision: string,
    operation: FeatureNavigationOperation,
    name: string,
    signal?: AbortSignal,
  ) {
    return repositoryGatewayClient.post<FeatureNavigationPayload>(
      `/api/v1/repository-gateway/${repositoryPath(owner, repo)}/features`,
      token,
      { revision, operation, name },
      signal,
    );
  },
  semantic(
    token: string,
    owner: string,
    repo: string,
    revision: string,
    operation: SemanticNavigationOperation,
    query: string,
    signal?: AbortSignal,
  ) {
    return repositoryGatewayClient.post<SemanticNavigationPayload>(
      `/api/v1/repository-gateway/${repositoryPath(owner, repo)}/semantics`,
      token,
      { revision, operation, query },
      signal,
    );
  },
  listDirectory(token: string, repositoryId: string, relativePath = "", signal?: AbortSignal) {
    return standardApiClient.post<DirectoryEntry[]>("/tools/list-dir", token, { repositoryId, relativePath }, signal);
  },
  readFile(token: string, repositoryId: string, relativePath: string, signal?: AbortSignal) {
    return standardApiClient.post<FileReadResult>("/tools/read-file", token, { repositoryId, relativePath }, signal);
  },
  fileTree(token: string, repositoryId: string, signal?: AbortSignal) {
    return standardApiClient.post<FileTreeNode>("/tools/file-tree", token, { repositoryId }, signal);
  },
};
