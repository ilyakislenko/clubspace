import { z } from 'zod'

const ClubRefSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
})

export const ExportMyDataFeatureOutputSchema = z.object({
    // Bumped if the layout of this file ever changes incompatibly.
    formatVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    profile: z.object({
        id: z.string().uuid(),
        // Null in a child profile's export (dependents have no e-mail).
        email: z.string().nullable(),
        phone: z.string().nullable(),
        firstname: z.string().nullable(),
        lastname: z.string().nullable(),
        dateOfBirth: z.iso.date().nullable(),
        description: z.string().nullable(),
        profilePhotoUrl: z.string().nullable(),
        language: z.string(),
        createdAt: z.iso.datetime(),
        lastSeenAt: z.iso.datetime(),
    }),
    consents: z.array(
        z.object({
            kind: z.string(),
            version: z.string(),
            acceptedAt: z.iso.datetime(),
            ip: z.string().nullable(),
            userAgent: z.string().nullable(),
            withdrawnAt: z.iso.datetime().nullable(),
        }),
    ),
    memberships: z.array(
        z.object({
            club: ClubRefSchema,
            role: z.string(),
            status: z.string(),
            joinedAt: z.iso.datetime(),
            accessUntil: z.iso.datetime().nullable(),
        }),
    ),
    attendance: z.array(
        z.object({
            club: ClubRefSchema,
            title: z.string(),
            startAt: z.iso.datetime(),
            markedAt: z.iso.datetime(),
            isGuest: z.boolean(),
        }),
    ),
    // Abonements with their payment: amount in minor units (kopecks).
    subscriptions: z.array(
        z.object({
            club: ClubRefSchema,
            plan: z.string(),
            status: z.string(),
            startDate: z.iso.datetime().nullable(),
            endDate: z.iso.datetime().nullable(),
            classesTotal: z.number().int().nullable(),
            classesRemaining: z.number().int().nullable(),
            amountPaid: z.number().int(),
            currency: z.string(),
            isPaid: z.boolean(),
            paidAt: z.iso.datetime().nullable(),
            createdAt: z.iso.datetime(),
        }),
    ),
    // Online payments made through the club's provider (whole currency units,
    // like Plan.price).
    payments: z.array(
        z.object({
            club: ClubRefSchema,
            plan: z.string(),
            provider: z.string(),
            status: z.string(),
            amount: z.number().int(),
            currency: z.string(),
            createdAt: z.iso.datetime(),
            paidAt: z.iso.datetime().nullable(),
            refundedAt: z.iso.datetime().nullable(),
        }),
    ),
    freezes: z.array(
        z.object({
            club: ClubRefSchema,
            fromDate: z.iso.date(),
            untilDate: z.iso.date(),
            reason: z.string().nullable(),
            endedEarlyAt: z.iso.datetime().nullable(),
        }),
    ),
    journal: z.array(
        z.object({
            club: ClubRefSchema,
            entryDate: z.iso.date(),
            body: z.string(),
            createdAt: z.iso.datetime(),
        }),
    ),
    ranks: z.array(
        z.object({
            club: ClubRefSchema,
            ladder: z.string(),
            level: z.string(),
            stripes: z.number().int(),
            note: z.string().nullable(),
            awardedAt: z.iso.datetime(),
        }),
    ),
    // Sections cut at the per-section cap (the oldest rows are kept).
    truncated: z.array(z.string()),
})

export class ExportMyDataFeature {
    constructor(readonly userId: string) {}
}

export type ExportMyDataFeatureResponse = z.infer<
    typeof ExportMyDataFeatureOutputSchema
>
