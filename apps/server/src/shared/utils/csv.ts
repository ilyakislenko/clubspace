export type CsvValue = string | number | null | undefined

// Quote a field when it contains a delimiter, quote, newline, or edge
// whitespace; embedded quotes are doubled (RFC 4180).
const escapeField = (value: CsvValue): string => {
    if (value == null) return ''
    const s = String(value)
    if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`
    }
    return s
}

// UTF-8 byte-order mark (U+FEFF) — makes Excel open Cyrillic correctly.
const BOM = String.fromCharCode(0xfeff)

/**
 * Build an RFC-4180 CSV string with a UTF-8 BOM and CRLF line endings (what
 * spreadsheet apps expect).
 */
export const toCsv = (
    headers: string[],
    rows: ReadonlyArray<ReadonlyArray<CsvValue>>,
): string => {
    const lines = [headers, ...rows].map((row) =>
        row.map(escapeField).join(','),
    )
    return BOM + lines.join('\r\n')
}
