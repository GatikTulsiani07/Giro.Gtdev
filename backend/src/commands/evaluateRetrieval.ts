const args = process.argv.slice(2);
const mode = args[0] ?? "evaluate";

if (!["evaluate", "regression", "baseline", "external"].includes(mode)) {
  process.stderr.write(`Unknown retrieval evaluation mode: ${mode}\n`);
  process.exitCode = 2;
} else {
  const external = mode === "external";
  process.env.NODE_ENV ??= "test";
  process.env.LOG_LEVEL ??= "error";
  process.env.SUPABASE_URL ??= "https://offline-evaluation.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "offline-evaluation-key";
  if (!external) {
    process.env.OPENAI_API_KEY ??= "sk-offline-evaluation-not-used";
  }
  if (external && !process.env.OPENAI_API_KEY?.trim()) {
    process.stderr.write("External reranker evaluation requires OPENAI_API_KEY.\n");
    process.exitCode = 2;
  } else {
    const { runRetrievalEvaluationCommand } = await import(
      "../evaluation/retrieval/cli.js"
    );
    try {
      process.exitCode = await runRetrievalEvaluationCommand(
        mode as "evaluate" | "regression" | "baseline" | "external",
        args.slice(1),
      );
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Retrieval evaluation failed."}\n`,
      );
      process.exitCode = 1;
    }
  }
}
