import { z } from 'zod'

export const PromotionOutputSchema = z.object({
    id: z.string().uuid(),
    ladderId: z.string().uuid(),
    ladderName: z.string(),
    levelId: z.string().uuid(),
    levelName: z.string(),
    color: z.string().nullable(),
    stripes: z.number().int(),
    note: z.string().nullable(),
    awardedAt: z.iso.datetime(),
})
export type PromotionOutput = z.infer<typeof PromotionOutputSchema>

export const MemberRanksOutputSchema = z.object({
    // The latest promotion per ladder (a member can hold a rank on several
    // ladders, e.g. Gi and No-Gi).
    current: z.array(PromotionOutputSchema),
    history: z.array(PromotionOutputSchema),
})

export const serializePromotion = (p: {
    id: string
    ladderId: string
    ladder: { name: string }
    levelId: string
    level: { name: string; color: string | null }
    stripes: number
    note: string | null
    awardedAt: Date
}): PromotionOutput => ({
    id: p.id,
    ladderId: p.ladderId,
    ladderName: p.ladder.name,
    levelId: p.levelId,
    levelName: p.level.name,
    color: p.level.color,
    stripes: p.stripes,
    note: p.note,
    awardedAt: p.awardedAt.toISOString(),
})

// One row of a ladder's roster: every rankable person in the club (active
// members + the owner) and where they stand on that ladder, if anywhere.
export const LadderRosterEntrySchema = z.object({
    userId: z.string().uuid(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string(),
    isOwner: z.boolean(),
    current: z
        .object({
            levelId: z.string().uuid(),
            levelName: z.string(),
            color: z.string().nullable(),
            stripes: z.number().int(),
            awardedAt: z.iso.datetime(),
        })
        .nullable(),
})
export type LadderRosterEntry = z.infer<typeof LadderRosterEntrySchema>

export const serializeLadderRosterEntry = (
    user: {
        id: string
        firstname: string | null
        lastname: string | null
        email: string
    },
    isOwner: boolean,
    latest: {
        levelId: string
        level: { name: string; color: string | null }
        stripes: number
        awardedAt: Date
    } | null,
): LadderRosterEntry => ({
    userId: user.id,
    firstname: user.firstname,
    lastname: user.lastname,
    email: user.email,
    isOwner,
    current: latest
        ? {
              levelId: latest.levelId,
              levelName: latest.level.name,
              color: latest.level.color,
              stripes: latest.stripes,
              awardedAt: latest.awardedAt.toISOString(),
          }
        : null,
})
