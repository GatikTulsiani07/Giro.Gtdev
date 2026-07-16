import type { Metadata } from "next";
import { RepositoryOverview } from "@/features/repositories/repository-overview";

export const metadata: Metadata = { title: "Repository" };
export default async function RepositoryPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  return <RepositoryOverview owner={decodeURIComponent(owner)} repo={decodeURIComponent(repo)} />;
}
