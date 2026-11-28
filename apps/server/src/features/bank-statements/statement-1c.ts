import {
    cleanPayer,
    parseStatementAmount,
    parseStatementDate,
    type StatementTransaction,
} from './statement-values'

// «1CClientBankExchange»: the text file every Russian business bank exports
// «для 1С». Header keys (`РасчСчет=` — the accounts the statement is for,
// `ДатаНачала=`, `ДатаКонца=`), then one `СекцияДокумент=…` … `КонецДокумента`
// block per payment with `Дата`, `Номер`, `Сумма`, `Плательщик`/`Плательщик1`,
// `ПлательщикСчет`, `ПолучательСчет`, `ДатаПоступило`, `НазначениеПлатежа`.
// Encoding: `Кодировка=Windows` (1251) or `DOS` (866); some banks write UTF-8.

export const ONE_C_SIGNATURE = '1CClientBankExchange'

export type Parsed1C = {
    transactions: StatementTransaction[]
    // Outgoing payments and transfers between the club's own accounts.
    skippedDebits: number
}

// The signature is ASCII, so it is found before the encoding is known.
export const isOneCFile = (bytes: Uint8Array): boolean => {
    const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
    return (
        new TextDecoder('latin1').decode(bytes.subarray(start, start + 40)).trimStart().startsWith(ONE_C_SIGNATURE)
    )
}

const decode1C = (bytes: Uint8Array): string => {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
    } catch {
        // Windows-1251 and DOS-866 are told apart by which one reads the
        // file's own section keyword.
        const cp1251 = new TextDecoder('windows-1251').decode(bytes)
        if (cp1251.includes('СекцияДокумент') || cp1251.includes('Кодировка')) return cp1251
        return new TextDecoder('ibm866').decode(bytes)
    }
}

type Doc = Record<string, string>

export const parse1C = (bytes: Uint8Array): Parsed1C => {
    const lines = decode1C(bytes).split(/\r\n|\n|\r/)
    const accounts = new Set<string>()
    const docs: Doc[] = []
    let doc: Doc | null = null
    for (const raw of lines) {
        const line = raw.trim()
        if (line === '') continue
        const eq = line.indexOf('=')
        const key = (eq === -1 ? line : line.slice(0, eq)).trim()
        const value = eq === -1 ? '' : line.slice(eq + 1).trim()
        if (key === 'СекцияДокумент') {
            doc = {}
            continue
        }
        if (key === 'КонецДокумента') {
            if (doc) docs.push(doc)
            doc = null
            continue
        }
        if (doc) {
            // Old exports split the purpose into НазначениеПлатежа1…6.
            if (/^НазначениеПлатежа\d$/.test(key)) {
                doc.НазначениеПлатежа = [doc.НазначениеПлатежа, value].filter(Boolean).join(' ')
            } else if (!(key in doc)) {
                doc[key] = value
            }
        } else if (key === 'РасчСчет' && value) {
            // The header and every СекцияРасчСчет name the statement's accounts.
            accounts.add(value)
        }
    }

    const transactions: StatementTransaction[] = []
    let skippedDebits = 0
    for (const d of docs) {
        const toUs = d.ПолучательСчет ? accounts.has(d.ПолучательСчет) : false
        const fromUs = d.ПлательщикСчет ? accounts.has(d.ПлательщикСчет) : false
        // Without account lines, a credit is what has «ДатаПоступило».
        const credit =
            accounts.size > 0 ? toUs && !fromUs : Boolean(d.ДатаПоступило) && !d.ДатаСписано
        const amountMinor = parseStatementAmount(d.Сумма ?? '')
        const when = parseStatementDate(d.ДатаПоступило || d.Дата || '')
        if (!credit || amountMinor === null || amountMinor <= 0 || !when) {
            skippedDebits++
            continue
        }
        transactions.push({
            date: when.date,
            time: null,
            amountMinor,
            currency: 'RUB',
            payer: cleanPayer(d.Плательщик1 || d.Плательщик || ''),
            purpose: (d.НазначениеПлатежа ?? '').replace(/\s+/g, ' ').trim(),
            docNumber: d.Номер?.trim() || null,
        })
    }
    return { transactions, skippedDebits }
}
