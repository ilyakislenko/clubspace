import {
    cleanPayer,
    normalizeCurrency,
    parseStatementAmount,
    parseStatementDate,
    type StatementTransaction,
} from './statement-values'

// A bank's operations export as a table (CSV or Excel): Т-Банк («Дата
// операции», «Сумма операции», «Валюта операции», «Статус», «Описание» with the
// sender «Иван И.»), Сбер and others («Дата», «Приход»/«Расход», «Контрагент»,
// «Назначение»). The header row is found among the first rows (some exports
// start with a title block), the columns by their names; when that fails the
// admin picks them (the mapping comes back with the next upload).

export type ColumnMapping = {
    date: number | null
    amount: number | null
    payer: number | null
    purpose: number | null
}

export type TableColumns = ColumnMapping & {
    currency: number | null
    status: number | null
    docNumber: number | null
    // «Тип операции», «Дебет/Кредит», «Приход/Расход» as text next to an
    // unsigned amount.
    direction: number | null
}

export type ParsedTable = {
    headers: string[]
    // The first data rows, for the column picker.
    sample: string[][]
    columns: TableColumns
    // date, amount and payer known: the transfers below are read.
    complete: boolean
    // Whether the file tells incoming from outgoing: direction cells that read
    // as one side, a credit-only amount column, or negative/empty amounts on
    // some rows. An unsigned amount alone may be a refund the club paid out,
    // so nothing is pre-selected without it.
    directionKnown: boolean
    transactions: StatementTransaction[]
    skippedDebits: number
}

const HEADER_SCAN_ROWS = 30
const SAMPLE_ROWS = 3

const norm = (h: string) => h.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

// First header (in priority order of the patterns) that matches.
const pick = (
    headers: string[],
    patterns: RegExp[],
    exclude: RegExp | null = null,
): number | null => {
    for (const p of patterns) {
        const i = headers.findIndex((h) => p.test(h) && !(exclude && exclude.test(h)))
        if (i !== -1) return i
    }
    return null
}

export const detectColumns = (rawHeaders: string[]): TableColumns => {
    const h = rawHeaders.map(norm)
    const amountExclude =
        /кэшб|бонус|округлен|комисс|остаток|баланс|приход\s*[/-]\s*расход|дебет\s*[/-]\s*кредит/
    return {
        date: pick(h, [/^дата операции/, /^дата проведения/, /^дата$/, /^дата/]),
        amount: pick(
            h,
            [
                /^сумма операции$/,
                /^сумма платежа$/,
                /^сумма в валюте сч/,
                // Separate credit columns: the debit side stays empty there.
                /^(приход|поступлени|зачислени|кредит)/,
                /^сумма по кредиту/,
                /^сумма/,
            ],
            amountExclude,
        ),
        payer: pick(h, [/плательщик/, /отправител/, /контрагент/, /от кого/, /^описание/, /наименование/], /сч[её]т|инн|банк/),
        purpose: pick(h, [/назначение/, /комментари/, /сообщени/, /детали/]),
        currency: pick(h, [/^валюта операции$/, /^валюта$/, /^валюта/]),
        status: pick(h, [/^статус/]),
        docNumber: pick(h, [/номер документа/, /№ документа/, /^номер операции/, /^№$/, /^номер$/]),
        direction: pick(h, [
            /^тип операции/,
            /^(дебет|д)\s*[/-]\s*(кредит|к)$/,
            /^приход\s*[/-]\s*расход/,
            /^направление/,
            /^тип$/,
        ]),
    }
}

// An amount header that only holds money coming in.
const CREDIT_HEADER = /^(приход|поступлени|зачислени|кредит|сумма по кредиту)/
const INCOMING = /кредит|приход|поступ|зачисл|пополн|входящ|credit|income|^к$|^c$|^\+$/i
const OUTGOING = /дебет|расход|списан|исходящ|debit|^д$|^d$|^[-−]$/i

const isHeaderRow = (row: string[]): boolean => {
    const c = detectColumns(row)
    return c.date !== null && c.amount !== null
}

const FAILED_STATUS = /fail|отклон|отмен|ошибк|error|declin/i

export const parseTable = (
    rows: string[][],
    override: ColumnMapping | null,
): ParsedTable => {
    const headerAt = Math.max(
        0,
        rows.slice(0, HEADER_SCAN_ROWS).findIndex((r) => isHeaderRow(r)),
    )
    const width = Math.max(0, ...rows.map((r) => r.length))
    const headers = Array.from(
        { length: width },
        (_, i) => (rows[headerAt]?.[i] ?? '').trim() || `Колонка ${i + 1}`,
    )
    const data = rows.slice(headerAt + 1).filter((r) => r.some((c) => c.trim() !== ''))
    const detected = detectColumns(rows[headerAt] ?? [])
    const inRange = (i: number | null) => (i !== null && i >= 0 && i < width ? i : null)
    const columns: TableColumns = override
        ? {
              ...detected,
              date: inRange(override.date),
              amount: inRange(override.amount),
              payer: inRange(override.payer),
              purpose: inRange(override.purpose),
          }
        : detected
    const complete = columns.date !== null && columns.amount !== null && columns.payer !== null
    const sample = data.slice(0, SAMPLE_ROWS).map((r) => headers.map((_, i) => (r[i] ?? '').trim()))
    if (!complete) {
        return { headers, sample, columns, complete, directionKnown: false, transactions: [], skippedDebits: 0 }
    }
    // Known from the amount column itself, or below from a negative/empty
    // amount or a direction cell we could actually read.
    let directionKnown = CREDIT_HEADER.test(norm(headers[columns.amount as number] ?? ''))

    const cell = (r: string[], i: number | null) => (i === null ? '' : (r[i] ?? '').trim())
    const transactions: StatementTransaction[] = []
    let skippedDebits = 0
    for (const r of data) {
        const when = parseStatementDate(cell(r, columns.date))
        // A totals line, a page header repeated mid-file: not an operation.
        if (!when) continue
        const amountMinor = parseStatementAmount(cell(r, columns.amount))
        // Empty in a credit column («Приход») or negative: outgoing.
        if (amountMinor === null || amountMinor <= 0) {
            directionKnown = true
            skippedDebits++
            continue
        }
        // A direction cell decides only when it reads as one side; anything
        // else («Перевод СБП») falls back to the sign rules above.
        const direction = cell(r, columns.direction)
        const saysIn = INCOMING.test(direction)
        const saysOut = OUTGOING.test(direction)
        if (saysIn !== saysOut) directionKnown = true
        if ((saysOut && !saysIn) || FAILED_STATUS.test(cell(r, columns.status))) {
            skippedDebits++
            continue
        }
        const purpose = columns.purpose === columns.payer ? '' : cell(r, columns.purpose)
        transactions.push({
            date: when.date,
            time: when.time,
            amountMinor,
            currency: normalizeCurrency(cell(r, columns.currency)),
            payer: cleanPayer(cell(r, columns.payer)),
            purpose: purpose.replace(/\s+/g, ' '),
            docNumber: cell(r, columns.docNumber) || null,
        })
    }
    return { headers, sample, columns, complete, directionKnown, transactions, skippedDebits }
}
