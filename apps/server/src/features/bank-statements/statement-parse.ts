import { createHash } from 'crypto'

import { readSheet } from 'read-excel-file/node'

import { BadRequestError } from '../../shared/errors/shared.errors'
import { decodeCsvBytes, detectDelimiter, parseCsv } from '../club-import/club-import-csv'
import { isOneCFile, parse1C } from './statement-1c'
import { parseTable, type ColumnMapping, type ParsedTable } from './statement-table'
import { normalizeName } from './statement-match'
import type { StatementFormat, StatementTransaction } from './statement-values'
import { rebuildXlsxSafely, XLSX_BROKEN } from './statement-xlsx-guard'

// Bytes of an uploaded statement → incoming transfers. The file lives only in
// this request (docs/design/2026-11-28-bank-statement-match.md §2).

export const STATEMENT_MAX_BYTES = 5 * 1024 * 1024
export const STATEMENT_MAX_ROWS = 20_000
export const STATEMENT_MAX_TRANSACTIONS = 3_000
// The column picker offers 0–199; a wider «table» is a broken file.
export const STATEMENT_MAX_COLUMNS = 200

export const UNKNOWN_FORMAT_MESSAGE =
    'Не удалось распознать выписку. Подходят выгрузка для 1С (файл .txt «1CClientBankExchange») и выписка операций в CSV или Excel (.xlsx) из интернет-банка'

export type ParsedStatement = {
    format: StatementFormat
    transactions: StatementTransaction[]
    skippedDebits: number
    // The file tells incoming from outgoing (always for 1C; see ParsedTable).
    directionKnown: boolean
    // CSV / Excel only: the columns read, and what the picker shows.
    table: Omit<ParsedTable, 'transactions' | 'skippedDebits' | 'directionKnown'> | null
}

type XlsxCell = string | number | boolean | Date | null | undefined

const pad = (n: number) => String(n).padStart(2, '0')

// Excel cells → the strings the table reader parses: dates «ДД.ММ.ГГГГ ЧЧ:ММ»
// (read-excel-file returns them as UTC wall clock), numbers with a dot.
const xlsxCellText = (cell: XlsxCell): string => {
    if (cell === null || cell === undefined) return ''
    if (cell instanceof Date) {
        const day = `${pad(cell.getUTCDate())}.${pad(cell.getUTCMonth() + 1)}.${cell.getUTCFullYear()}`
        const time = `${pad(cell.getUTCHours())}:${pad(cell.getUTCMinutes())}`
        return time === '00:00' ? day : `${day} ${time}`
    }
    return String(cell)
}

const readXlsx = async (bytes: Uint8Array): Promise<string[][]> => {
    // The library never sees the upload itself: only the entries the guard
    // inflated under a cap, re-stored with exact sizes (no zip bomb possible).
    const safe = rebuildXlsxSafely(bytes)
    try {
        const rows = (await readSheet(safe)) as XlsxCell[][]
        return rows.map((r) => r.map(xlsxCellText))
    } catch {
        throw new BadRequestError({ message: XLSX_BROKEN })
    }
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b)

export const parseStatement = async (
    bytes: Uint8Array,
    mapping: ColumnMapping | null,
): Promise<ParsedStatement> => {
    if (bytes.length === 0) throw new BadRequestError({ message: 'Файл пустой' })
    if (bytes.length > STATEMENT_MAX_BYTES) {
        throw new BadRequestError({
            message: `Файл больше ${STATEMENT_MAX_BYTES / 1024 / 1024} МБ — выгрузите выписку за период короче`,
        })
    }
    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
        throw new BadRequestError({
            message:
                'PDF-выписку прочитать нельзя — выгрузите её из интернет-банка в формате 1С (.txt), CSV или Excel',
        })
    }
    if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
        throw new BadRequestError({
            message: 'Старый формат Excel (.xls) не читается — сохраните выписку как .xlsx или CSV',
        })
    }

    let result: ParsedStatement
    if (isOneCFile(bytes)) {
        result = { format: 'ONE_C', ...parse1C(bytes), directionKnown: true, table: null }
    } else {
        const isXlsx = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
        let rows: string[][]
        if (isXlsx) {
            rows = await readXlsx(bytes)
        } else {
            const { text } = decodeCsvBytes(bytes)
            if (text.includes('\u0000')) throw new BadRequestError({ message: UNKNOWN_FORMAT_MESSAGE })
            rows = parseCsv(text, detectDelimiter(text))
        }
        if (rows.length > STATEMENT_MAX_ROWS) {
            throw new BadRequestError({
                message: `В файле больше ${STATEMENT_MAX_ROWS} строк — выгрузите выписку за период короче`,
            })
        }
        const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
        if (rows.length < 2 || width < 2) {
            throw new BadRequestError({ message: UNKNOWN_FORMAT_MESSAGE })
        }
        if (width > STATEMENT_MAX_COLUMNS) {
            throw new BadRequestError({
                message: `В файле больше ${STATEMENT_MAX_COLUMNS} колонок — это не похоже на выписку операций`,
            })
        }
        const { transactions, skippedDebits, directionKnown, ...table } = parseTable(rows, mapping)
        result = { format: isXlsx ? 'XLSX' : 'CSV', transactions, skippedDebits, directionKnown, table }
    }
    if (result.transactions.length > STATEMENT_MAX_TRANSACTIONS) {
        throw new BadRequestError({
            message: `В выписке больше ${STATEMENT_MAX_TRANSACTIONS} поступлений — выгрузите период короче`,
        })
    }
    return result
}

// One fingerprint per transfer: the club, day (and time when known), amount,
// payer and document number, plus how many identical lines came before it in
// the file (two equal transfers on one day stay two). Stored instead of the
// transfer itself; the same statement uploaded again gives the same values.
export const fingerprintTransactions = (
    workspaceId: string,
    transactions: StatementTransaction[],
): string[] => {
    const seen = new Map<string, number>()
    return transactions.map((t) => {
        const base = [
            workspaceId,
            t.time ? `${t.date}T${t.time}` : t.date,
            t.amountMinor,
            normalizeName(t.payer),
            t.docNumber ?? '',
        ].join('|')
        const n = seen.get(base) ?? 0
        seen.set(base, n + 1)
        return createHash('sha256').update(`${base}|${n}`).digest('hex')
    })
}
