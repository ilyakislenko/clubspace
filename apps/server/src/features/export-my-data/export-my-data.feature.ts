import { z } from 'zod'

const ClubRefSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
})

const VideoRefSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
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
    // The linked Telegram chat for notifications; null when none is linked.
    telegram: z
        .object({
            chatId: z.string(),
            linkedAt: z.iso.datetime(),
        })
        .nullable(),
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
    // Personal notes on club lessons (one per lesson).
    videoNotes: z.array(
        z.object({
            club: ClubRefSchema,
            video: VideoRefSchema,
            text: z.string(),
            updatedAt: z.iso.datetime(),
        }),
    ),
    // Lesson bookmarks (moments / A–B segments) with their spaced-repetition
    // schedule. Deleted ones are kept as tombstones for offline sync and are
    // listed with deletedAt. The drawing itself is not included, only whether
    // there is one.
    bookmarks: z.array(
        z.object({
            club: ClubRefSchema,
            video: VideoRefSchema,
            positionSec: z.number().int(),
            endSec: z.number().int().nullable(),
            label: z.string(),
            note: z.string(),
            hasDrawing: z.boolean(),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
            deletedAt: z.iso.datetime().nullable(),
            review: z
                .object({
                    dueAt: z.iso.datetime(),
                    intervalDays: z.number().int(),
                    ease: z.number(),
                    reps: z.number().int(),
                    lapses: z.number().int(),
                    lastReviewedAt: z.iso.datetime(),
                })
                .nullable(),
        }),
    ),
    studyPlans: z.array(
        z.object({
            club: ClubRefSchema,
            title: z.string(),
            description: z.string().nullable(),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
            items: z.array(
                z.object({
                    position: z.number().int(),
                    video: VideoRefSchema,
                    startSec: z.number().int(),
                    endSec: z.number().int().nullable(),
                    title: z.string(),
                    note: z.string().nullable(),
                    createdAt: z.iso.datetime(),
                }),
            ),
        }),
    ),
    // «Разбор видео»: uploaded clips (metadata only, not the video) with the
    // request sent with each and the coaches' comments on it.
    videoReviews: z.array(
        z.object({
            club: ClubRefSchema,
            clip: z.object({
                status: z.string(),
                durationSec: z.number().int().nullable(),
                sizeBytes: z.number().int().nullable(),
                createdAt: z.iso.datetime(),
            }),
            request: z
                .object({
                    title: z.string(),
                    message: z.string().nullable(),
                    status: z.string(),
                    createdAt: z.iso.datetime(),
                    updatedAt: z.iso.datetime(),
                    comments: z.array(
                        z.object({
                            atSec: z.number().int(),
                            endSec: z.number().int().nullable(),
                            text: z.string(),
                            hasDrawing: z.boolean(),
                            createdAt: z.iso.datetime(),
                            updatedAt: z.iso.datetime(),
                        }),
                    ),
                })
                .nullable(),
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
