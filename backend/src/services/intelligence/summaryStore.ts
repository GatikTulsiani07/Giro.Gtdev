// Persists repository summaries to Supabase. Degrades gracefully if the table
// is missing so summary generation never hard-fails on a missing migration.

import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import type { RepositorySummary } from "./types.js";

const TABLE = "repository_summaries";

export async function saveSummary(summary: RepositorySummary): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { repository: summary.repository, summary, updated_at: new Date().toISOString() },
      { onConflict: "repository" },
    );

  if (error) {
    logger.warn("summary_persist_failed", {
      repository: summary.repository,
      message: error.message,
    });
  }
}

export async function loadSummary(
  repository: string,
): Promise<RepositorySummary | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("summary")
    .eq("repository", repository)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { summary: RepositorySummary }).summary;
}
