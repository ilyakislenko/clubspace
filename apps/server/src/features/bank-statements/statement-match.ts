// Matching incoming transfers to unpaid abonements («Сверить выписку»,
// docs/design/2026-11-28-bank-statement-match.md §3). Pure: no Prisma, no
// clock. Conservative on purpose — a wrong automatic match marks the wrong
// person paid, a missed one costs the admin one click.
//
// Every transfer and every abonement is tokenised once; a transfer is scored
// only against the abonements an index says could fit (same amount, a name
// or phone that occurs in its text), so a 3 000 × 1 000 statement stays fast.

export type MatchPerson = {
    firstname: string | null
    lastname: string | null
    phone: string | null
}

export type MatchCandidate = {
    subscriptionId: string
    // Agreed price, whole currency units.
    amount: number
    currency: string
    // Club-local days, YYYY-MM-DD: the abonement's start (null: from the first
    // visit) and the sale.
    startDate: string | null
    soldOn: string
    member: MatchPerson
    // The member's guardians (parents) as the club recorded them, confirmed
    // or not yet: they pay for children. The admin confirms every match.
    guardians: MatchPerson[]
}

export type MatchTransaction = {
    date: string
    amountMinor: number
    currency: string
    payer: string
    purpose: string
}

export type MatchReason =
    | 'AMOUNT_EXACT'
    | 'AMOUNT_CLOSE'
    | 'PAYER_NAME'
    | 'PAYER_SHORT_NAME'
    | 'PAYER_SURNAME'
    | 'GUARDIAN_NAME'
    | 'GUARDIAN_SHORT_NAME'
    | 'PURPOSE_NAME'
    | 'PHONE'
    | 'DATE_CLOSE'

export type MatchFlag =
    // The best candidate's price differs from the amount received.
    | 'AMOUNT_DIFFERS'
    // The amount equals several of the payer's abonements together.
    | 'SEVERAL_ABONEMENTS'
    // Another transfer of the statement points at the same abonement.
    | 'SAME_ABONEMENT_TWICE'
    // Two candidates fit about equally well.
    | 'SIMILAR_CANDIDATES'
    // A transfer of this day and amount was confirmed before, maybe from
    // another export of the same statement (set by the preview handler).
    | 'MAYBE_ALREADY_MATCHED'

export type MatchStatus = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED'

export type CandidateScore = {
    subscriptionId: string
    score: number
    reasons: MatchReason[]
    // Index into candidate.guardians of the parent whose name matched, else null.
    guardianIndex: number | null
}

export type TransactionMatch = {
    status: MatchStatus
    // Set only for MATCHED: the abonement pre-selected for confirmation.
    suggestedSubscriptionId: string | null
    candidates: CandidateScore[]
    flags: MatchFlag[]
}

// Window around the sale/start in which a transfer may pay an abonement.
export const MATCH_DAYS_BEFORE = 30
export const MATCH_DAYS_AFTER = 120
// «Иван И.» alone is confident only this close to the abonement.
const SHORT_NAME_MAX_DAYS = 31
// The best candidate must lead the second by this much to be confident.
const CONFIDENT_LEAD = 20
const MAX_CANDIDATES = 5
// Amounts within this share of the price count as «close» (partial payments,
// a bank fee, a rounded transfer).
const CLOSE_SHARE = 0.1
// A declined form differs from the name by at most this many trailing letters.
const MAX_ENDING = 3

// Identity levels: 3 = full name or phone, 2 = «Иван И.», 1 = surname only.
type Level = 0 | 1 | 2 | 3

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

// Lower case, ё → е, letters and spaces only; «И.И.» stays as two initials.
export const normalizeName = (s: string): string =>
    fold(s)
        .replace(/[^\p{L}]+/gu, ' ')
        .trim()

type Token = { text: string; dotted: boolean }

// Words with whether a dot followed them: «И.» is an initial, «в» is a word.
const tokenize = (s: string): Token[] =>
    [...fold(s).matchAll(/(\p{L}+)(\.?)/gu)].map((m) => ({ text: m[1], dotted: m[2] === '.' }))

// «Миша» → «миш» (matches «Мишу», «Миши»); short or consonant-final names stay.
const stemOf = (w: string) => (w.length >= 4 ? w.replace(/[аеиоуыэюяйь]$/, '') : w)

type Person = {
    first: string | null
    last: string | null
    firstStem: string | null
    lastStem: string | null
    phone: string | null
}

const phoneKey = (phone: string | null) => {
    const d = (phone ?? '').replace(/\D/g, '')
    return d.length >= 10 ? d.slice(-10) : null
}

const preparePerson = (p: MatchPerson): Person => {
    const first = tokenize(p.firstname ?? '')[0]?.text ?? null
    const last = tokenize(p.lastname ?? '')[0]?.text ?? null
    return {
        first,
        last,
        firstStem: first && first.length >= 3 ? stemOf(first) : null,
        lastStem: last && last.length >= 3 ? stemOf(last) : null,
        phone: phoneKey(p.phone),
    }
}

// How strongly a text names the person: «Иванов Иван Иванович», «ИВАНОВ И.И.»
// → 3; «Иван И.» (card-bank style) → 2; «Иванов» alone → 1. An initial that
// contradicts the first name («Иванов П.») → 0. An initial counts only when
// written with a dot, or right after the person's surname or first name
// («ИВАНОВ И И»), so a preposition or conjunction («оплата в ноябре»,
// «и Иванов») is never one; the purpose passes `initials: false`. First name
// and surname must be different words.
const levelOf = (tokens: Token[], person: Person, initials: boolean): Level => {
    const { first, last } = person
    if (!first && !last) return 0
    const at = (w: string | null) =>
        w && w.length > 1 ? tokens.flatMap((t, i) => (t.text === w ? [i] : [])) : []
    const lastAt = at(last)
    const firstAt = at(first)
    const hasLast = lastAt.length > 0
    const hasFirst = first === last ? firstAt.length >= 2 : firstAt.length > 0
    const isName = (t: Token | undefined) => !!t && t.text.length > 1 && (t.text === first || t.text === last)
    const isLetter = (t: Token | undefined) => !!t && t.text.length === 1
    const letters = initials
        ? tokens
              .filter(
                  (t, i) =>
                      isLetter(t) &&
                      (t.dotted ||
                          isName(tokens[i - 1]) ||
                          (isLetter(tokens[i - 1]) && isName(tokens[i - 2]))),
              )
              .map((t) => t.text)
        : []
    const firstInitial = first !== null && letters[0] === first[0]
    if (hasLast && (hasFirst || firstInitial)) return 3
    if (hasFirst && !hasLast && last !== null && letters.includes(last[0])) return 2
    if (hasLast && letters.length === 0) return 1
    return 0
}

// Exported for direct specs: the level of a payer text for a person.
export const nameLevel = (text: string, person: MatchPerson): Level =>
    levelOf(tokenize(text), preparePerson(person), true)

// Words of the text that are the name in some case form («петрова» for Петров).
const stemHits = (words: string[], stem: string | null): number[] =>
    stem ? words.flatMap((w, i) => (w.startsWith(stem) && w.length - stem.length <= MAX_ENDING ? [i] : [])) : []

type Text = {
    day: number
    payer: Token[]
    purpose: Token[]
    purposeWords: string[]
    phones: Set<string>
}

// How the purpose names the student: 2 = surname and first name in different
// words (any case form, «за Петрова Мишу»), 1 = the first name only («за
// Мишу» — tells siblings apart once a parent is known to be the payer; a word
// that is the surname «Петрова» never counts as «Пётр»), 0 = not at all.
const purposeNamesMember = (t: Text, member: Person): 0 | 1 | 2 => {
    if (levelOf(t.purpose, member, false) === 3) return 2
    const lastAt = stemHits(t.purposeWords, member.lastStem)
    const firstOnly = stemHits(t.purposeWords, member.firstStem).filter((i) => !lastAt.includes(i))
    if (firstOnly.length === 0) return 0
    return lastAt.length > 0 ? 2 : 1
}

// Phone numbers in the text, as their last 10 digits.
const phonesIn = (text: string): Set<string> => {
    const out = new Set<string>()
    for (const m of text.matchAll(/(?:\+?\d[\s()-]*)?\(?\d{3}\)?[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g)) {
        const digits = m[0].replace(/\D/g, '')
        if (digits.length >= 10 && digits.length <= 11) out.add(digits.slice(-10))
    }
    return out
}

const dayNumber = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000

const prepareText = (t: MatchTransaction): Text => {
    const purpose = tokenize(t.purpose)
    return {
        day: dayNumber(t.date),
        payer: tokenize(t.payer),
        purpose,
        purposeWords: purpose.map((w) => w.text),
        phones: phonesIn(`${t.payer} ${t.purpose}`),
    }
}

type Prepared = {
    c: MatchCandidate
    priceMinor: number
    anchors: number[]
    from: number
    to: number
    member: Person
    guardians: Person[]
}

const prepareCandidate = (c: MatchCandidate): Prepared => {
    const anchors = [c.soldOn, c.startDate].filter((d): d is string => d !== null).map(dayNumber)
    return {
        c,
        priceMinor: c.amount * 100,
        anchors,
        from: Math.min(...anchors) - MATCH_DAYS_BEFORE,
        to: Math.max(...anchors) + MATCH_DAYS_AFTER,
        member: preparePerson(c.member),
        guardians: c.guardians.map(preparePerson),
    }
}

// Which abonements could fit a transfer at all: same amount, a member's or
// parent's name or phone in the text, the student's name stem in the purpose.
class CandidateIndex {
    private readonly byAmount = new Map<number, Prepared[]>()
    private readonly byWord = new Map<string, Prepared[]>()
    private readonly byStem = new Map<string, Prepared[]>()
    private readonly byPhone = new Map<string, Prepared[]>()
    readonly byId = new Map<string, Prepared>()

    constructor(candidates: MatchCandidate[]) {
        for (const c of candidates) {
            const p = prepareCandidate(c)
            this.byId.set(c.subscriptionId, p)
            this.add(this.byAmount, p.priceMinor, p)
            for (const person of [p.member, ...p.guardians]) {
                for (const w of [person.first, person.last]) if (w && w.length > 1) this.add(this.byWord, w, p)
                if (person.phone) this.add(this.byPhone, person.phone, p)
            }
            for (const s of [p.member.firstStem, p.member.lastStem]) if (s) this.add(this.byStem, s, p)
        }
    }

    private add<K>(map: Map<K, Prepared[]>, key: K, p: Prepared) {
        const list = map.get(key)
        if (list) {
            if (list[list.length - 1] !== p) list.push(p)
        } else {
            map.set(key, [p])
        }
    }

    lookup(t: MatchTransaction, text: Text): Prepared[] {
        const found = new Set<Prepared>(this.byAmount.get(t.amountMinor) ?? [])
        const take = (list: Prepared[] | undefined) => list?.forEach((p) => found.add(p))
        for (const w of [...text.payer, ...text.purpose]) take(this.byWord.get(w.text))
        for (const w of text.purposeWords) {
            for (let n = Math.max(3, w.length - MAX_ENDING); n <= w.length; n++) take(this.byStem.get(w.slice(0, n)))
        }
        for (const ph of text.phones) take(this.byPhone.get(ph))
        return [...found].filter((p) => p.c.currency === t.currency && text.day >= p.from && text.day <= p.to)
    }
}

type Scored = CandidateScore & { level: Level; exact: boolean; days: number }

const scoreCandidate = (t: MatchTransaction, text: Text, p: Prepared): Scored | null => {
    const days = Math.min(...p.anchors.map((a) => Math.abs(text.day - a)))
    const reasons: MatchReason[] = []
    let score = 0
    const exact = t.amountMinor === p.priceMinor
    if (exact) {
        reasons.push('AMOUNT_EXACT')
        score += 50
    } else if (p.priceMinor > 0 && Math.abs(t.amountMinor - p.priceMinor) <= p.priceMinor * CLOSE_SHARE) {
        reasons.push('AMOUNT_CLOSE')
        score += 20
    }

    // Who paid: the member themself or a parent. The payer field holds the
    // sender; СБП transfers in a 1C file put a parent in the purpose instead
    // (the member named in the purpose is scored below).
    let level: Level = levelOf(text.payer, p.member, true)
    let guardianIndex: number | null = null
    for (const [i, g] of p.guardians.entries()) {
        const gl = Math.max(levelOf(text.payer, g, true), levelOf(text.purpose, g, false)) as Level
        // A parent's bare surname says nothing the child's doesn't.
        if (gl >= 2 && gl > level) {
            level = gl
            guardianIndex = i
        }
    }
    if (guardianIndex !== null) {
        reasons.push(level === 3 ? 'GUARDIAN_NAME' : 'GUARDIAN_SHORT_NAME')
    } else if (level > 0) {
        reasons.push((['PAYER_SURNAME', 'PAYER_SHORT_NAME', 'PAYER_NAME'] as const)[level - 1])
    }
    score += [0, 12, 28, 40][level]

    // The student named in the purpose («за Петрова Мишу»), beyond the payer.
    const named = purposeNamesMember(text, p.member)
    if (named === 2 && !reasons.includes('PAYER_NAME')) {
        reasons.push('PURPOSE_NAME')
        score += 35
        level = 3
    } else if (named === 1 && guardianIndex !== null) {
        reasons.push('PURPOSE_NAME')
        score += 25
    }

    if ([p.member, ...p.guardians].some((person) => person.phone !== null && text.phones.has(person.phone))) {
        reasons.push('PHONE')
        score += 45
        level = 3
    }

    if (days <= 14) reasons.push('DATE_CLOSE')
    score += Math.max(0, 10 - Math.floor(days / 3))

    // Listed when the amount is exact, the payer is clearly named (a partial
    // payment), or a surname comes with a close amount.
    const listed = exact || level >= 2 || (level === 1 && reasons.includes('AMOUNT_CLOSE'))
    if (!listed) return null
    return { subscriptionId: p.c.subscriptionId, score, reasons, guardianIndex, level, exact, days }
}

const NO_MATCH: TransactionMatch = { status: 'UNMATCHED', suggestedSubscriptionId: null, candidates: [], flags: [] }

const matchOne = (t: MatchTransaction, index: CandidateIndex): TransactionMatch => {
    const text = prepareText(t)
    const scored = index
        .lookup(t, text)
        .map((p) => scoreCandidate(t, text, p))
        .filter((s): s is Scored => s !== null)
        .sort((a, b) => b.score - a.score || a.days - b.days || a.subscriptionId.localeCompare(b.subscriptionId))
    if (scored.length === 0) return NO_MATCH

    const flags: MatchFlag[] = []
    const [top, second] = scored
    if (!top.exact) flags.push('AMOUNT_DIFFERS')

    // Several abonements of the same payer that sum to the amount: one
    // transfer for two children, or two abonements at once — marked by hand.
    const named = scored.filter((s) => s.level >= 2)
    const minor = (s: Scored) => index.byId.get(s.subscriptionId)?.priceMinor ?? 0
    const sums =
        named.length >= 2 &&
        (named.reduce((a, s) => a + minor(s), 0) === t.amountMinor ||
            named.some((a, i) => named.slice(i + 1).some((b) => minor(a) + minor(b) === t.amountMinor)))
    if (sums) flags.push('SEVERAL_ABONEMENTS')

    const tied = second !== undefined && second.score > top.score - CONFIDENT_LEAD
    if (tied && top.level > 0) flags.push('SIMILAR_CANDIDATES')

    const confident =
        top.exact && top.level >= 2 && (top.level === 3 || top.days <= SHORT_NAME_MAX_DAYS) && !tied && !sums
    return {
        status: confident ? 'MATCHED' : 'AMBIGUOUS',
        suggestedSubscriptionId: confident ? top.subscriptionId : null,
        candidates: scored.slice(0, MAX_CANDIDATES).map(({ subscriptionId, score, reasons, guardianIndex }) => ({
            subscriptionId,
            score,
            reasons,
            guardianIndex,
        })),
        flags,
    }
}

// A match the admin must look at: nothing pre-selected, the candidates kept.
export const holdBack = (r: TransactionMatch, flag: MatchFlag | null = null): TransactionMatch => ({
    ...r,
    status: r.status === 'MATCHED' ? 'AMBIGUOUS' : r.status,
    suggestedSubscriptionId: null,
    flags: flag && !r.flags.includes(flag) ? [...r.flags, flag] : r.flags,
})

// One result per transaction, in order. One transfer pays at most one
// abonement; an abonement two transfers point at confidently is offered to
// neither automatically.
export const matchStatement = (
    transactions: MatchTransaction[],
    candidates: MatchCandidate[],
): TransactionMatch[] => {
    const index = new CandidateIndex(candidates)
    const results = transactions.map((t) => matchOne(t, index))
    const claims = new Map<string, number>()
    for (const r of results) {
        if (r.suggestedSubscriptionId) {
            claims.set(r.suggestedSubscriptionId, (claims.get(r.suggestedSubscriptionId) ?? 0) + 1)
        }
    }
    return results.map((r) =>
        r.suggestedSubscriptionId && (claims.get(r.suggestedSubscriptionId) ?? 0) > 1
            ? holdBack(r, 'SAME_ABONEMENT_TWICE')
            : r,
    )
}
