import { emailSchema } from '../../shared/utils/email'
import { normalizePhone } from '../../shared/utils/phone'
import type { ClubImportMapping } from './club-import-fields'

// One CSV row read through the confirmed mapping: typed, validated values.
// Pure — the engine decides what they mean for the club.
export type ClubImportRecord = {
    firstname: string | null
    lastname: string | null
    email: string | null
    phone: string | null
    // YYYY-MM-DD
    dateOfBirth: string | null
    parentEmail: string | null
    gym: string | null
    direction: string | null
    group: string | null
    rank: string | null
    stripes: number | null
    plan: string | null
    startDate: string | null
    endDate: string | null
    classesLeft: number | null
    paid: boolean | null
    notes: string | null
}

const NAME_MAX = 100
const REF_MAX = 120
const NOTES_MAX = 2000

const pad = (n: number) => String(n).padStart(2, '0')

const validYmd = (y: number, m: number, d: number): string | null => {
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null
    const date = new Date(Date.UTC(y, m - 1, d))
    if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
    return `${y}-${pad(m)}-${pad(d)}`
}

// «15.04.1990», «5.4.1990», «15/04/1990», «15-04-1990», «15.04.90», ISO
// «1990-04-15»; a time part Excel may add («15.04.1990 0:00») is ignored.
// Two-digit years: up to the current year's two digits → 20xx, else 19xx.
// null = not a date.
export const parseRuDate = (raw: string, now: Date = new Date()): string | null => {
    const s = raw.trim().split(/\s+/)[0]
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
    if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]))
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s)
    if (!m) return null
    let year = Number(m[3])
    if (m[3].length === 2) {
        const current = now.getUTCFullYear() % 100
        year += year <= current ? 2000 : 1900
    }
    return validYmd(year, Number(m[2]), Number(m[1]))
}

const YES = ['да', 'д', 'yes', 'y', 'true', '1', '+', 'оплачено', 'оплачен', 'v', '✓', '✔']
const NO = ['нет', 'н', 'no', 'n', 'false', '0', '-', 'не оплачено', 'не оплачен']

// null = not recognised.
export const parseYesNo = (raw: string): boolean | null => {
    const s = raw.trim().toLowerCase().replace(/ё/g, 'е')
    if (YES.includes(s)) return true
    if (NO.includes(s)) return false
    return null
}

const parseCount = (raw: string, max: number): number | null => {
    const s = raw.replace(/\s/g, '')
    if (!/^\d+$/.test(s)) return null
    const n = Number(s)
    return n <= max ? n : null
}

// «Фамилия Имя Отчество» (the Russian order of ФИО). One word is a first
// name. The patronymic is not stored (the profile has no field for it).
export const splitFullName = (
    raw: string,
): { firstname: string | null; lastname: string | null } => {
    const parts = raw.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return { firstname: null, lastname: null }
    if (parts.length === 1) return { firstname: parts[0], lastname: null }
    return { lastname: parts[0], firstname: parts[1] }
}

// Collapses inner whitespace; '' → null.
const clean = (raw: string | undefined): string | null => {
    const s = (raw ?? '').replace(/\s+/g, ' ').trim()
    return s === '' ? null : s
}

export type RecordResult = {
    record: ClubImportRecord
    errors: string[]
    warnings: string[]
}

export const readRecord = (
    cells: string[],
    mapping: ClubImportMapping,
    now: Date = new Date(),
): RecordResult => {
    const errors: string[] = []
    const warnings: string[] = []
    const cell = (key: keyof ClubImportMapping): string | null => {
        const idx = mapping[key]
        return idx === undefined ? null : clean(cells[idx])
    }

    let firstname = cell('firstname')
    let lastname = cell('lastname')
    const full = cell('fullName')
    if (full && !firstname && !lastname) {
        ;({ firstname, lastname } = splitFullName(full))
    }
    if ((firstname?.length ?? 0) > NAME_MAX || (lastname?.length ?? 0) > NAME_MAX) {
        errors.push(`Имя или фамилия длиннее ${NAME_MAX} символов`)
    }

    const readEmail = (key: 'email' | 'parentEmail', label: string) => {
        const raw = cell(key)
        if (!raw) return null
        const parsed = emailSchema.safeParse(raw)
        if (!parsed.success) {
            errors.push(`${label}: «${raw}» — не похоже на e-mail`)
            return null
        }
        return parsed.data
    }
    const email = readEmail('email', 'E-mail')
    const parentEmail = readEmail('parentEmail', 'E-mail родителя')

    let phone: string | null = null
    const rawPhone = cell('phone')
    if (rawPhone) {
        phone = normalizePhone(rawPhone)
        if (!phone) {
            warnings.push(
                `Телефон «${rawPhone}» не сохранён: нужен номер с кодом страны (+7…) или российский с 8 в начале`,
            )
        }
    }

    const readDate = (key: 'dateOfBirth' | 'startDate' | 'endDate', label: string) => {
        const raw = cell(key)
        if (!raw) return null
        const ymd = parseRuDate(raw, now)
        if (!ymd) errors.push(`${label}: «${raw}» — нужна дата вида 31.12.2025`)
        return ymd
    }
    const dateOfBirth = readDate('dateOfBirth', 'Дата рождения')
    const startDate = readDate('startDate', 'Дата начала')
    const endDate = readDate('endDate', 'Дата окончания')
    if (dateOfBirth && dateOfBirth > now.toISOString().slice(0, 10)) {
        errors.push('Дата рождения в будущем')
    }
    if (startDate && endDate && endDate <= startDate) {
        errors.push('Дата окончания абонемента должна быть позже даты начала')
    }

    const readCount = (key: 'stripes' | 'classesLeft', label: string, max: number) => {
        const raw = cell(key)
        if (!raw) return null
        const n = parseCount(raw, max)
        if (n === null) errors.push(`${label}: «${raw}» — нужно целое число от 0 до ${max}`)
        return n
    }
    const stripes = readCount('stripes', 'Полоски', 20)
    const classesLeft = readCount('classesLeft', 'Осталось занятий', 1000)

    let paid: boolean | null = null
    const rawPaid = cell('paid')
    if (rawPaid) {
        paid = parseYesNo(rawPaid)
        if (paid === null) errors.push(`Оплачено: «${rawPaid}» — напишите «да» или «нет»`)
    }

    const ref = (key: 'gym' | 'direction' | 'group' | 'rank' | 'plan', label: string) => {
        const v = cell(key)
        if (v && v.length > REF_MAX) {
            errors.push(`${label}: название длиннее ${REF_MAX} символов`)
            return null
        }
        return v
    }
    const record: ClubImportRecord = {
        firstname,
        lastname,
        email,
        phone,
        dateOfBirth,
        parentEmail,
        gym: ref('gym', 'Зал'),
        direction: ref('direction', 'Направление'),
        group: ref('group', 'Группа'),
        rank: ref('rank', 'Пояс'),
        stripes,
        plan: ref('plan', 'Абонемент'),
        startDate,
        endDate,
        classesLeft,
        paid,
        notes: cell('notes')?.slice(0, NOTES_MAX) ?? null,
    }

    if (!record.firstname && !record.lastname && !record.email && errors.length === 0) {
        errors.push('Нет ни имени, ни e-mail')
    }
    if (record.stripes !== null && !record.rank) {
        warnings.push('Полоски без пояса не сохранены')
    }
    if (!record.plan && (startDate || endDate || classesLeft !== null || paid !== null)) {
        warnings.push('Даты, остаток и оплата без абонемента не сохранены')
    }
    return { record, errors, warnings }
}
