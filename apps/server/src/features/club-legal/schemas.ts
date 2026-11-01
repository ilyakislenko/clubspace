import { z } from 'zod'

import {
    clubLegalStatus,
    type LegalVersions,
    missingSellerRequisites,
} from '../../domains/billing/club-legal'
import type { ClubLegalState } from '../../domains/billing/services/club-legal.service'
import { environment } from '../../environments/environment'
import type { ClubLegalAcceptance } from '../../infrastructure/prisma'

// The platform's contract with a club: the current editions of the offer and
// the data processing instruction, and where the club stands with them.
// Shared by the club's «Тариф» page, the banner and the platform console.

export const ClubLegalAcceptanceSourceSchema = z.enum([
    'SIGNUP',
    'CONSOLE',
    'OWNER',
    'PAYMENT',
])

export const ClubLegalStatusSchema = z.object({
    // Current editions (apps/client /legal/offer/<version>, /legal/dpa/<version>).
    offerVersion: z.string(),
    dpaVersion: z.string(),
    // Days the owner has to accept a new edition.
    graceDays: z.number().int(),
    // The latest acceptance covers both current editions.
    upToDate: z.boolean(),
    // Accept by then; null when up to date.
    acceptBy: z.iso.datetime().nullable(),
    // The grace is over: payments, card binding and module connection are
    // refused until the owner accepts.
    required: z.boolean(),
    // The club's latest acceptance; null = never accepted.
    accepted: z
        .object({
            offerVersion: z.string(),
            dpaVersion: z.string(),
            acceptedAt: z.iso.datetime(),
            source: ClubLegalAcceptanceSourceSchema,
            userName: z.string().nullable(),
        })
        .nullable(),
})

export const ClubLegalViewSchema = ClubLegalStatusSchema.extend({
    // The caller is the club owner — only they accept for the club.
    canAccept: z.boolean(),
})

// One acceptance as evidence, for the platform console.
export const ClubLegalAcceptanceSchema = z.object({
    id: z.string().uuid(),
    source: ClubLegalAcceptanceSourceSchema,
    offerVersion: z.string(),
    dpaVersion: z.string(),
    acceptedAt: z.iso.datetime(),
    userId: z.string().uuid(),
    userEmail: z.string().nullable(),
    userName: z.string().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    // CONSOLE: the operator who recorded it.
    recordedById: z.string().uuid().nullable(),
    // PAYMENT: the payment that carried it.
    paymentId: z.string().uuid().nullable(),
})

export const PlatformClubLegalSchema = ClubLegalStatusSchema.extend({
    // Newest first.
    acceptances: z.array(ClubLegalAcceptanceSchema),
})

export type ClubLegalStatusView = z.infer<typeof ClubLegalStatusSchema>

type AcceptanceRow = Pick<
    ClubLegalAcceptance,
    'offerVersion' | 'dpaVersion' | 'acceptedAt' | 'source' | 'userName'
>

export const serializeClubLegalStatus = (
    state: Pick<ClubLegalState, 'current' | 'status'> & {
        latest: AcceptanceRow | null
    },
): ClubLegalStatusView => ({
    offerVersion: state.current.offerVersion,
    dpaVersion: state.current.dpaVersion,
    graceDays: environment.billing.legal.acceptGraceDays,
    upToDate: state.status.upToDate,
    acceptBy: state.status.acceptBy?.toISOString() ?? null,
    required: state.status.required,
    accepted: state.latest
        ? {
              offerVersion: state.latest.offerVersion,
              dpaVersion: state.latest.dpaVersion,
              acceptedAt: state.latest.acceptedAt.toISOString(),
              source: state.latest.source,
              userName: state.latest.userName,
          }
        : null,
})

export const serializeClubLegalAcceptance = (
    row: ClubLegalAcceptance,
): z.infer<typeof ClubLegalAcceptanceSchema> => ({
    id: row.id,
    source: row.source,
    offerVersion: row.offerVersion,
    dpaVersion: row.dpaVersion,
    acceptedAt: row.acceptedAt.toISOString(),
    userId: row.userId,
    userEmail: row.userEmail,
    userName: row.userName,
    ip: row.ip,
    userAgent: row.userAgent,
    recordedById: row.recordedById,
    paymentId: row.paymentId,
})

// The console card: the status plus the evidence rows (newest first), from
// rows already loaded — the console loader has no ClubLegalService.
export const platformClubLegal = (p: {
    current: LegalVersions
    acceptances: ClubLegalAcceptance[]
    clubCreatedAt: Date
    now: Date
}): z.infer<typeof PlatformClubLegalSchema> => {
    const latest = p.acceptances[0] ?? null
    const status = clubLegalStatus({
        current: p.current,
        accepted: latest,
        clubCreatedAt: p.clubCreatedAt,
        graceDays: environment.billing.legal.acceptGraceDays,
        now: p.now,
    })
    return {
        ...serializeClubLegalStatus({ current: p.current, status, latest }),
        acceptances: p.acceptances.map(serializeClubLegalAcceptance),
    }
}

// What /legal/* needs from the server: the current editions and the seller's
// requisites (null = not configured, rendered «заполняется»).
export const PublicLegalOutputSchema = z.object({
    offerVersion: z.string(),
    dpaVersion: z.string(),
    acceptGraceDays: z.number().int(),
    seller: z.object({
        name: z.string().nullable(),
        inn: z.string().nullable(),
        ogrnip: z.string().nullable(),
        address: z.string().nullable(),
        bankName: z.string().nullable(),
        bik: z.string().nullable(),
        account: z.string().nullable(),
        corrAccount: z.string().nullable(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
    }),
    // Every requisite an invoice needs is set (production card billing is
    // off until then).
    sellerComplete: z.boolean(),
})

export const serializePublicLegal = (): z.infer<typeof PublicLegalOutputSchema> => {
    const { offerVersion, dpaVersion, acceptGraceDays, seller } = environment.billing.legal
    const orNull = (v: string) => v.trim() || null
    return {
        offerVersion,
        dpaVersion,
        acceptGraceDays,
        seller: {
            name: orNull(seller.name),
            inn: orNull(seller.inn),
            ogrnip: orNull(seller.ogrnip),
            address: orNull(seller.address),
            bankName: orNull(seller.bankName),
            bik: orNull(seller.bik),
            account: orNull(seller.account),
            corrAccount: orNull(seller.corrAccount),
            email: orNull(seller.email),
            phone: orNull(seller.phone),
        },
        sellerComplete: missingSellerRequisites(seller).length === 0,
    }
}
