export function truncateRetrievalContext(
  content: string,
  maxCharacters: number,
): string {
  if (maxCharacters <= 0) {
    return "";
  }

  if (content.length <= maxCharacters) {
    return content;
  }

  return content.slice(0, maxCharacters);
}