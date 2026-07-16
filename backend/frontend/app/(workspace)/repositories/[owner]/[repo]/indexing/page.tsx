import type { Metadata } from "next";
import { IndexingProgressView } from "@/features/indexing/indexing-progress-view";

export const metadata: Metadata = { title: "Indexing repository" };
export default async function IndexingPage({ params, searchParams }: { params: Promise<{ owner: string; repo: string }>; searchParams: Promise<{ jobId?: string }> }) {
  const [{ owner, repo }, query] = await Promise.all([params, searchParams]);
  return <IndexingProgressView owner={decodeURIComponent(owner)} repo={decodeURIComponent(repo)} jobId={query.jobId} />;
}
