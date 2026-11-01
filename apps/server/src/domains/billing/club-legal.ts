// The platform's contract with a club (apps/client /legal/offer, /legal/dpa,
// /legal/requisites; docs/legal/README.md) and the pure rules around it
// (unit-tested in club-legal.spec.ts). The club owner accepts the current
// editions of the offer and the data processing instruction (DPA) — at
// sign-up, on the first card payment, or on the «Тариф» page; a newer edition
// gives them acceptGraceDays to accept, after which the club's paid actions
// are refused until they do.

import { addDays } from './billing-rules'

// An edition is named by its effective date, optionally with a suffix for a
// second edition on the same day: «2026-11-01», «2026-11-01.2».
const VERSION_RE = /^(\d{4}-\d{2}-\d{2})(?:[.-][0-9A-Za-z]+)*$/

export const parseLegalVersion = (raw: string, envName: string): string => {
    const value = raw.trim()
    const match = VERSION_RE.exec(value)
    const date = match ? new Date(`${match[1]}T00:00:00.000Z`) : null
    if (!match || !date || Number.isNaN(date.getTime()) || value.length > 64) {
        throw new Error(
            `${envName} must be an edition date like 2026-11-01 (optionally 2026-11-01.2), got «${raw}»`,
        )
    }
    return value
}

// The edition's effective date (UTC midnight): the grace for accepting it
// counts from here.
export const legalVersionDate = (version: string): Date =>
    new Date(`${version.slice(0, 10)}T00:00:00.000Z`)

export type LegalVersions = {
    offerVersion: string
    dpaVersion: string
}

export type LegalAcceptanceRef = LegalVersions & { acceptedAt: Date }

export type ClubLegalStatus = {
    // The club's latest acceptance covers both current editions.
    upToDate: boolean
    // Until when the owner may still accept without paid actions being
    // refused; null when up to date.
    acceptBy: Date | null
    // The grace is over and the current editions are not accepted: paid
    // actions are refused until the owner accepts.
    required: boolean
}

// Where a club stands with the current editions. The grace counts from the
// later of the club's creation and the effective date of each edition it has
// not accepted — a club created from the console without an acceptance gets
// the full grace from its creation, an old club from the new edition's date.
export const clubLegalStatus = (p: {
    current: LegalVersions
    accepted: LegalVersions | null
    clubCreatedAt: Date
    graceDays: number
    now: Date
}): ClubLegalStatus => {
    const offerAccepted = p.accepted?.offerVersion === p.current.offerVersion
    const dpaAccepted = p.accepted?.dpaVersion === p.current.dpaVersion
    if (offerAccepted && dpaAccepted) {
        return { upToDate: true, acceptBy: null, required: false }
    }
    let since = p.clubCreatedAt.getTime()
    if (!offerAccepted) {
        since = Math.max(since, legalVersionDate(p.current.offerVersion).getTime())
    }
    if (!dpaAccepted) {
        since = Math.max(since, legalVersionDate(p.current.dpaVersion).getTime())
    }
    const acceptBy = addDays(new Date(since), p.graceDays)
    return { upToDate: false, acceptBy, required: p.now >= acceptBy }
}

// The seller's requisites shown on /legal/requisites and the offer. Blank =
// not configured yet (the pages render «заполняется»).
export type SellerRequisites = {
    name: string
    inn: string
    ogrnip: string
    address: string
    bankName: string
    bik: string
    account: string
    corrAccount: string
    email: string
    phone: string
}

// What an invoice, a receipt and the offer cannot go without. Until all are
// set, a production install keeps card billing off (platformGatewayCredentials).
export const REQUIRED_SELLER_FIELDS = [
    'name',
    'inn',
    'ogrnip',
    'address',
    'bankName',
    'bik',
    'account',
] as const satisfies readonly (keyof SellerRequisites)[]

export const missingSellerRequisites = (
    seller: SellerRequisites,
): (keyof SellerRequisites)[] =>
    REQUIRED_SELLER_FIELDS.filter((field) => !seller[field].trim())

export const LEGAL_ACCEPTANCE_REQUIRED_MESSAGE =
    'Опубликована новая редакция договора-оферты и поручения на обработку персональных данных, срок для их принятия истёк. Владелец клуба может принять их на странице «Тариф» — после этого оплата и подключение модулей снова доступны.'
