// Rules are plain text; a blank line separates paragraphs, a single newline
// stays inside one.
export const paragraphs = (text: string | null): string[] =>
  (text ?? "")
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)

// «+7 952 884-94-20» → «tel:+79528849420»; dialers reject spaces and dashes.
export const telUrl = (phone: string): string =>
  `tel:${phone.replace(/[^\d+]/g, "")}`
