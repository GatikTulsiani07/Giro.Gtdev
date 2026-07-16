import { apiRequest } from "./client";
import type { HybridRetrievalResult } from "@/types/api";

export const retrievalApi = {
  inspect(token: string, input: { query: string; owner: string; repo: string; limit?: number }) {
    return apiRequest<HybridRetrievalResult>("/retrieval/hybrid", {
      method: "POST",
      token,
      body: JSON.stringify(input),
    });
  },
};
