// A small Markdown reader for the assistant's answers: paragraphs, headings,
// lists, tables, code, **bold**, *italic*, `code` — and entity tokens
// (m_…/c_… pseudonyms, [group:id], [plan:id]) the screen turns into chips.
// Rendered as React elements (ChatMarkdown.tsx), never as HTML, so nothing a
// model writes can inject markup.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'italic'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'entity'; token: string };

export type Block =
  | { kind: 'p'; lines: Inline[][] }
  | { kind: 'h'; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'ol'; start: number; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'code'; text: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const INLINE_RE = new RegExp(
  [
    `(\\[(?:group|plan):${UUID}\\])`,
    '((?<![\\w])[mc]_[0-9a-f]{10}(?![\\w]))',
    '`([^`]+)`',
    '\\*\\*(.+?)\\*\\*',
    '(?<![\\w*])\\*(?!\\s)([^*]+?)\\*(?![\\w*])',
    '(?<![\\w])_(?!\\s)([^_]+?)_(?![\\w])',
  ].join('|'),
  'g',
);

export const parseInline = (text: string): Inline[] => {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    if (m[1] || m[2]) out.push({ kind: 'entity', token: m[1] ?? m[2] });
    else if (m[3] !== undefined) out.push({ kind: 'code', text: m[3] });
    else if (m[4] !== undefined)
      out.push({ kind: 'bold', children: parseInline(m[4]) });
    else
      out.push({ kind: 'italic', children: parseInline(m[5] ?? m[6] ?? '') });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
};

const UL_RE = /^\s*[-*•]\s+(.*)$/;
const OL_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TABLE_RE = /^\s*\|.*\|\s*$/;
const TABLE_RULE_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const tableCells = (line: string): Inline[][] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()));

export const parseMarkdown = (source: string): Block[] => {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```'))
        body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ kind: 'h', level, inline: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (
      TABLE_RE.test(line) &&
      i + 1 < lines.length &&
      TABLE_RULE_RE.test(lines[i + 1])
    ) {
      const head = tableCells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && TABLE_RE.test(lines[i]))
        rows.push(tableCells(lines[i++]));
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    if (UL_RE.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push(parseInline(UL_RE.exec(lines[i++])![1]));
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    const ordered = OL_RE.exec(line);
    if (ordered) {
      const items: Inline[][] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(parseInline(OL_RE.exec(lines[i++])![2]));
      }
      blocks.push({ kind: 'ol', start: Number(ordered[1]), items });
      continue;
    }
    // The first line always belongs to the paragraph (a lone «| a |» without
    // a rule line is text), so the loop always advances.
    const paragraph: Inline[][] = [parseInline(lines[i++].trim())];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING_RE.test(lines[i]) &&
      !UL_RE.test(lines[i]) &&
      !OL_RE.test(lines[i]) &&
      !TABLE_RE.test(lines[i]) &&
      !lines[i].trim().startsWith('```')
    ) {
      paragraph.push(parseInline(lines[i++].trim()));
    }
    blocks.push({ kind: 'p', lines: paragraph });
  }
  return blocks;
};
