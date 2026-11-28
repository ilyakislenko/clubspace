import {
    matchStatement,
    nameLevel,
    normalizeName,
    type MatchCandidate,
    type MatchTransaction,
} from './statement-match'

const person = (firstname: string, lastname: string, phone: string | null = null) => ({
    firstname,
    lastname,
    phone,
})

let seq = 0
const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
    subscriptionId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    amount: 3000,
    currency: 'RUB',
    startDate: '2026-11-01',
    soldOn: '2026-10-28',
    member: person('Иван', 'Иванов'),
    guardians: [],
    ...over,
})

const tx = (over: Partial<MatchTransaction> = {}): MatchTransaction => ({
    date: '2026-11-03',
    amountMinor: 300000,
    currency: 'RUB',
    payer: '',
    purpose: '',
    ...over,
})

const one = (t: MatchTransaction, cands: MatchCandidate[]) => matchStatement([t], cands)[0]

describe('normalizeName / nameLevel', () => {
    it('folds case and ё, keeps initials as letters', () => {
        expect(normalizeName('ФЁДОРОВ  Пётр И.И.')).toBe('федоров петр и и')
    })

    it.each([
        ['ИВАНОВ ИВАН ИВАНОВИЧ', 3],
        ['Иванов И.И.', 3],
        ['иванов иван', 3],
        ['Иван И.', 2],
        ['Иван Иванович И.', 2],
        ['Иванов', 1],
        // An initial that contradicts the first name.
        ['Иванов П.С.', 0],
        ['Петров Пётр', 0],
    ])('«%s» names Иван Иванов at level %d', (text, level) => {
        expect(nameLevel(text, person('Иван', 'Иванов'))).toBe(level)
    })

    it('treats ё and е alike in both the file and the roster', () => {
        expect(nameLevel('СЕМЕНОВ АРТЕМ', person('Артём', 'Семёнов'))).toBe(3)
        expect(nameLevel('Артём С.', person('Артем', 'Семенов'))).toBe(2)
    })
})

describe('matchStatement', () => {
    it('matches a full name with the exact amount confidently', () => {
        const c = candidate()
        const r = one(tx({ payer: 'ИВАНОВ ИВАН ИВАНОВИЧ' }), [c, candidate({ member: person('Анна', 'Смирнова') })])
        expect(r.status).toBe('MATCHED')
        expect(r.suggestedSubscriptionId).toBe(c.subscriptionId)
        expect(r.candidates[0].reasons).toEqual(expect.arrayContaining(['AMOUNT_EXACT', 'PAYER_NAME', 'DATE_CLOSE']))
    })

    it('matches initials «Иванов И.И.»', () => {
        const c = candidate()
        expect(one(tx({ payer: 'Иванов И.И.' }), [c]).suggestedSubscriptionId).toBe(c.subscriptionId)
    })

    it('matches a card-bank «Иван И.» close to the abonement, not a month and more later', () => {
        const c = candidate()
        expect(one(tx({ payer: 'Иван И.' }), [c]).status).toBe('MATCHED')
        const late = one(tx({ payer: 'Иван И.', date: '2026-12-20' }), [c])
        expect(late.status).toBe('AMBIGUOUS')
        expect(late.candidates[0].reasons).toContain('PAYER_SHORT_NAME')
    })

    it('matches across ё / е', () => {
        const c = candidate({ member: person('Артём', 'Семёнов') })
        expect(one(tx({ payer: 'СЕМЕНОВ АРТЕМ' }), [c]).status).toBe('MATCHED')
    })

    it('matches a parent paying for a child and says who paid', () => {
        const child = candidate({
            member: person('Михаил', 'Петров'),
            guardians: [person('Олег', 'Петров'), person('Елена', 'Петрова')],
            amount: 4500,
        })
        const r = one(tx({ payer: 'ПЕТРОВА ЕЛЕНА СЕРГЕЕВНА', amountMinor: 450000 }), [child])
        expect(r.status).toBe('MATCHED')
        expect(r.candidates[0]).toMatchObject({ guardianIndex: 1, reasons: expect.arrayContaining(['GUARDIAN_NAME']) })
    })

    it('tells two children of one parent apart only by the purpose', () => {
        const mom = person('Елена', 'Петрова')
        const misha = candidate({ member: person('Михаил', 'Петров'), guardians: [mom] })
        const anya = candidate({ member: person('Анна', 'Петрова'), guardians: [mom] })
        const plain = one(tx({ payer: 'Петрова Елена Сергеевна' }), [misha, anya])
        expect(plain.status).toBe('AMBIGUOUS')
        expect(plain.flags).toContain('SIMILAR_CANDIDATES')
        expect(plain.candidates.map((c) => c.subscriptionId).sort()).toEqual(
            [misha.subscriptionId, anya.subscriptionId].sort(),
        )
        // «за Михаила» (a declined first name) settles it.
        const named = one(tx({ payer: 'Петрова Елена Сергеевна', purpose: 'Абонемент за Михаила' }), [misha, anya])
        expect(named.status).toBe('MATCHED')
        expect(named.suggestedSubscriptionId).toBe(misha.subscriptionId)
    })

    it('finds the student named in a declined form in the purpose', () => {
        const c = candidate({ member: person('Михаил', 'Петров') })
        const r = one(tx({ payer: 'ООО «Работодатель»', purpose: 'Оплата за Петрова Михаила, ноябрь' }), [c])
        expect(r.status).toBe('MATCHED')
        expect(r.candidates[0].reasons).toContain('PURPOSE_NAME')
    })

    it('matches a phone number in the purpose', () => {
        const c = candidate({ member: person('Анна', 'Сидорова', '+79135551234') })
        const r = one(tx({ payer: 'СИДОРОВА А.В.', purpose: 'Оплата занятий, тел. 8 (913) 555-12-34' }), [c])
        expect(r.status).toBe('MATCHED')
        expect(r.candidates[0].reasons).toContain('PHONE')
    })

    it('never auto-picks between two students with the same amount and no name', () => {
        const a = candidate()
        const b = candidate({ member: person('Анна', 'Смирнова') })
        const r = one(tx({ payer: 'АО «ТБанк»', purpose: 'Перевод' }), [a, b])
        expect(r.status).toBe('AMBIGUOUS')
        expect(r.suggestedSubscriptionId).toBeNull()
        expect(r.candidates).toHaveLength(2)
    })

    it('does not auto-match the right amount from an unknown payer', () => {
        expect(one(tx({ payer: 'Сергей К.' }), [candidate()]).status).toBe('AMBIGUOUS')
    })

    it('flags a partial payment instead of matching it', () => {
        const c = candidate({ amount: 5000 })
        const r = one(tx({ payer: 'Иванов Иван', amountMinor: 250000 }), [c])
        expect(r.status).toBe('AMBIGUOUS')
        expect(r.flags).toContain('AMOUNT_DIFFERS')
        expect(r.candidates[0].subscriptionId).toBe(c.subscriptionId)
    })

    it('flags one transfer for two abonements of the same parent', () => {
        const mom = person('Елена', 'Петрова')
        const misha = candidate({ member: person('Михаил', 'Петров'), guardians: [mom] })
        const anya = candidate({ member: person('Анна', 'Петрова'), guardians: [mom], amount: 2500 })
        const r = one(tx({ payer: 'Петрова Елена', amountMinor: 550000 }), [misha, anya])
        expect(r.status).toBe('AMBIGUOUS')
        expect(r.flags).toContain('SEVERAL_ABONEMENTS')
    })

    it('offers neither of two transfers that point at the same abonement', () => {
        const c = candidate()
        const [a, b] = matchStatement(
            [tx({ payer: 'Иванов Иван' }), tx({ payer: 'Иванов Иван', date: '2026-11-04' })],
            [c],
        )
        expect([a.status, b.status]).toEqual(['AMBIGUOUS', 'AMBIGUOUS'])
        expect(a.flags).toContain('SAME_ABONEMENT_TWICE')
        expect(b.candidates[0].subscriptionId).toBe(c.subscriptionId)
    })

    it('ignores abonements outside the date window and in another currency', () => {
        const old = candidate({ soldOn: '2026-01-10', startDate: '2026-01-10' })
        const future = candidate({ soldOn: '2027-02-01', startDate: '2027-02-01' })
        const usd = candidate({ currency: 'USD' })
        expect(one(tx({ payer: 'Иванов Иван' }), [old, future, usd]).status).toBe('UNMATCHED')
    })

    it('leaves a transfer nobody owes for unmatched', () => {
        const r = one(tx({ payer: 'ООО «РОМАШКА»', amountMinor: 1200000 }), [candidate()])
        expect(r).toEqual({ status: 'UNMATCHED', suggestedSubscriptionId: null, candidates: [], flags: [] })
    })

    it('waits for a first visit: an abonement without a start date matches by its sale', () => {
        const c = candidate({ startDate: null, soldOn: '2026-11-01' })
        expect(one(tx({ payer: 'Иванов Иван' }), [c]).status).toBe('MATCHED')
    })

    it('never reads a preposition as an initial («оплата в ноябре» is not В. Петров)', () => {
        const mom = person('Елена', 'Петрова')
        const viktor = candidate({ member: person('Виктор', 'Петров'), guardians: [mom] })
        const andrey = candidate({ member: person('Андрей', 'Петров'), guardians: [mom] })
        const r = one(
            tx({ payer: 'ПЕТРОВА ЕЛЕНА ИВАНОВНА', purpose: 'Оплата за занятия в ноябре Петров' }),
            [viktor, andrey],
        )
        expect(r.status).toBe('AMBIGUOUS')
        expect(r.suggestedSubscriptionId).toBeNull()
        expect(r.candidates.every((c) => !c.reasons.includes('PURPOSE_NAME'))).toBe(true)
    })

    it('takes an initial only with a dot or right after the name', () => {
        const ivan = person('Иван', 'Иванов')
        expect(nameLevel('ИВАНОВ И И', ivan)).toBe(3)
        expect(nameLevel('Иван И', person('Иван', 'Исаев'))).toBe(2)
        // A letter before the name, or away from it, is a conjunction or preposition.
        expect(nameLevel('платеж и Иванов', ivan)).toBe(1)
        // «и» far from the name is a conjunction.
        expect(nameLevel('Иванов оплата и взнос', ivan)).toBe(1)
        expect(nameLevel('Иван оплата и взнос', ivan)).toBe(0)
    })

    it('doesn’t take the surname «Петрова» for the first name Пётр', () => {
        const mom = person('Елена', 'Петрова')
        const petr = candidate({ member: person('Пётр', 'Петров'), guardians: [mom] })
        const misha = candidate({ member: person('Миша', 'Петров'), guardians: [mom] })
        const r = one(tx({ payer: 'Петрова Елена', purpose: 'Оплата за Петрова' }), [petr, misha])
        expect(r.status).toBe('AMBIGUOUS')
        expect(r.suggestedSubscriptionId).toBeNull()
        expect(r.candidates.every((c) => !c.reasons.includes('PURPOSE_NAME'))).toBe(true)
        // A first name in its own word still settles it («за Мишу Петрова»).
        const named = one(tx({ payer: 'Петрова Елена', purpose: 'Оплата за Мишу Петрова' }), [petr, misha])
        expect(named.suggestedSubscriptionId).toBe(misha.subscriptionId)
    })

    it('matches a full statement against a large club quickly (3 000 transfers × 1 000 abonements)', () => {
        const FIRST = ['Иван', 'Пётр', 'Анна', 'Мария', 'Олег', 'Ольга', 'Сергей', 'Дарья', 'Артём', 'Елена']
        const LAST = ['Иванов', 'Петров', 'Смирнов', 'Кузнецов', 'Попов', 'Соколов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов']
        const cands = Array.from({ length: 1000 }, (_, i) =>
            candidate({
                member: person(FIRST[i % 10], `${LAST[Math.floor(i / 10) % 10]}${i}`, `+7913${String(i).padStart(7, '0')}`),
                guardians: [person(FIRST[(i + 3) % 10], LAST[(i + 5) % 10])],
                amount: 2000 + (i % 20) * 100,
                soldOn: `2026-${String(1 + (i % 11)).padStart(2, '0')}-10`,
                startDate: null,
            }),
        )
        const txs = Array.from({ length: 3000 }, (_, i) =>
            tx({
                date: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`,
                amountMinor: (2000 + (i % 25) * 100) * 100,
                payer: `${LAST[i % 10]}${i % 1000} ${FIRST[(i * 7) % 10]} И.`,
                purpose: `Оплата абонемента за ноябрь, тел. 8 913 ${String(i % 1000).padStart(7, '0')} ${FIRST[i % 10]}у`,
            }),
        )
        const started = performance.now()
        const results = matchStatement(txs, cands)
        const ms = performance.now() - started
        expect(results).toHaveLength(3000)
        expect(results.some((r) => r.status !== 'UNMATCHED')).toBe(true)
        // Measured well under a second; the bound only catches a return to
        // per-pair tokenising (minutes).
        expect(ms).toBeLessThan(5000)
    })
})
