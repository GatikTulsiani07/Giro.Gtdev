import type { Metadata } from "next";
import { RepositoryFoundation } from "@/features/repositories/repository-foundation";

export const metadata: Metadata = { title: "Repository" };
export default async function RepositoryPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  return <RepositoryFoundation owner={decodeURIComponent(owner)} repo={decodeURIComponent(repo)} />;
}
