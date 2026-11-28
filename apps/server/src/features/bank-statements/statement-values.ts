// Shared shapes and cell readers of «Сверить выписку»: every statement format
// (1C exchange file, a bank's CSV or Excel export) becomes a list of incoming
// transfers in one shape (docs/design/2026-11-28-bank-statement-match.md §2).

// One incoming transfer (a credit to the club's account). Lives only for the
// request: the payer's name and the purpose are never stored.
export type StatementTransaction = {
    // Club-local calendar day of the credit, YYYY-MM-DD.
    date: string
    // HH:MM when the file has it (card-bank exports), else null.
    time: string | null
    // Exact amount in kopecks (minor units).
    amountMinor: number
    // ISO 4217; a file without a currency column is in roubles.
    currency: string
    payer: string
    purpose: string
    docNumber: string | null
}

export type StatementFormat = 'ONE_C' | 'CSV' | 'XLSX'

const RU_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::\d{2})?)?$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

const pad = (n: number) => String(n).padStart(2, '0')

const validDay = (y: number, m: number, d: number): boolean => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return false
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// «28.11.2026», «28.11.2026 14:03:11», «28.11.26», «2026-11-28T14:03» →
// { date, time }; anything else → null (the row is not a transaction).
export const parseStatementDate = (
    raw: string,
): { date: string; time: string | null } | null => {
    const s = raw.trim()
    let y: number, m: number, d: number
    let hh: string | undefined, mm: string | undefined
    const ru = RU_DATE.exec(s)
    const iso = ru ? null : ISO_DATE.exec(s)
    if (ru) {
        d = Number(ru[1])
        m = Number(ru[2])
        y = ru[3].length === 2 ? 2000 + Number(ru[3]) : Number(ru[3])
        hh = ru[4]
        mm = ru[5]
    } else if (iso) {
        y = Number(iso[1])
        m = Number(iso[2])
        d = Number(iso[3])
        hh = iso[4]
        mm = iso[5]
    } else {
        return null
    }
    if (!validDay(y, m, d)) return null
    const time =
        hh !== undefined && mm !== undefined && Number(hh) < 24 && Number(mm) < 60
            ? `${pad(Number(hh))}:${mm}`
            : null
    return { date: `${y}-${pad(m)}-${pad(d)}`, time: time === '00:00' ? null : time }
}

// «3 000,00», «-500.00», «+1 234,56 ₽», «1,234.56», «3000» → kopecks (signed);
// not a number → null.
export const parseStatementAmount = (raw: string): number | null => {
    let s = raw.replace(/[\s\u00a0\u202f]/g, '').replace(/(₽|руб\.?|rub|rur|р\.)$/i, '')
    if (s === '') return null
    let sign = 1
    if (s.startsWith('−') || s.startsWith('-')) {
        sign = -1
        s = s.slice(1)
    } else if (s.startsWith('+')) {
        s = s.slice(1)
    }
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    const decimal = lastComma > lastDot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    s = s.split(thousands).join('').replace(decimal, '.')
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
    const [whole, frac = ''] = s.split('.')
    return sign * (Number(whole) * 100 + Number(frac.padEnd(2, '0')))
}

// Currency words banks put in exports → ISO code; unknown text kept upper-cased.
export const normalizeCurrency = (raw: string): string => {
    const s = raw.trim().toUpperCase()
    if (s === '' || s === 'RUR' || s === '₽' || s.startsWith('РУБ') || s === '643') return 'RUB'
    return s.slice(0, 3)
}

// Payer text as banks write it, cut to the person or company: no ИНН/КПП, no
// «//адрес//» tail, no account numbers.
export const cleanPayer = (raw: string): string =>
    raw
        .split('//')[0]
        .replace(/(?<!\p{L})(ИНН|КПП)\s*\d+/giu, ' ')
        .replace(/(?<!\p{L})р\/с\s*\d+/giu, ' ')
        .replace(/\d{20}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
