export type CsvValue = string | number | null | undefined

// A leading =, +, -, @ (or a tab / carriage return) makes Excel, Google Sheets
// and LibreOffice evaluate the cell as a formula — the CSV/formula-injection
// vector. Since member names, emails and notes are user-supplied, a value like
// `=HYPERLINK(...)` would run when the owner opens the export.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/

// Fields are separated by «;»: Excel in a Russian locale reads «,» as the
// decimal mark and would pack a comma-separated file into a single column.
// Quote a field when it contains a delimiter, quote, newline, or edge
// whitespace; embedded quotes are doubled (RFC 4180). String cells that would
// be read as a formula are first neutralised with a leading apostrophe (the
// spreadsheet text marker). Only strings — numeric columns (amounts, counts)
// must stay numeric, and a number can't carry an injection.
const escapeField = (value: CsvValue): string => {
    if (value == null) return ''
    let s = String(value)
    if (typeof value === 'string' && FORMULA_TRIGGER.test(s)) {
        s = `'${s}`
    }
    if (/[";,\n\r]/.test(s) || /^\s|\s$/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`
    }
    return s
}

// UTF-8 byte-order mark (U+FEFF) — makes Excel open Cyrillic correctly.
const BOM = String.fromCharCode(0xfeff)

/**
 * Build a «;»-separated CSV string (RFC 4180 quoting) with a UTF-8 BOM and CRLF line endings (what
 * spreadsheet apps expect).
 */
export const toCsv = (
    headers: string[],
    rows: ReadonlyArray<ReadonlyArray<CsvValue>>,
): string => {
    const lines = [headers, ...rows].map((row) =>
        row.map(escapeField).join(';'),
    )
    return BOM + lines.join('\r\n')
}
