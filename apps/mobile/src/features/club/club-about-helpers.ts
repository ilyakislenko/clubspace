// Rules are plain text; a blank line separates paragraphs, a single newline
// stays inside one.
export const paragraphs = (text: string | null): string[] =>
  (text ?? "")
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
