export interface RetrievalPromptInput {
  question: string;
  context: string;
}

export function buildRetrievalPrompt(
  input: RetrievalPromptInput,
): string {
  return [
    "You are answering a question about a code repository.",
    "",
    "Use the repository context below.",
    "",
    "Repository Context:",
    input.context,
    "",
    "Question:",
    input.question,
  ].join("\n");
}