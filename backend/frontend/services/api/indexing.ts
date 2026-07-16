import { apiRequest } from "./client";
import type { IndexingJob } from "@/types/api";

export const indexingApi = {
  job(token: string, jobId: string) {
    return apiRequest<IndexingJob>(`/indexing/jobs/${encodeURIComponent(jobId)}`, { method: "GET", token });
  },
};
