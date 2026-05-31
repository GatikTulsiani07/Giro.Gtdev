// Maps a file extension (with leading dot) to a language label.

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript-react",
  ".js": "javascript",
  ".jsx": "javascript-react",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".css": "css",
  ".scss": "css",
  ".html": "html",
  ".sh": "shell",
  ".toml": "toml",
  ".sql": "sql",
};

export function detectLanguageFromExtension(ext: string): string {
  return LANGUAGE_BY_EXTENSION[ext] ?? "plaintext";
}
