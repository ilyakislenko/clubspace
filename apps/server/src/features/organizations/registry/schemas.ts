import { z } from 'zod'

// One belt in the registry: name + belt + club + date, nothing else (design
// §3.1). `personKey` addresses the person within this org only.
export const OrgRegistryRowSchema = z.object({
    personKey: z.string(),
    personName: z.string(),
    levelName: z.string(),
    levelColor: z.string().nullable(),
    stripes: z.number().int(),
    ladderName: z.string(),
    // «подтверждён клубом X».
    clubId: z.string().uuid(),
    clubName: z.string(),
    awardedAt: z.iso.date(),
    // The federation standard level, when the club adopted the standard.
    templateLevelName: z.string().nullable(),
    // Published tournament podiums of the person in this org («призёр»
    // when > 0; docs/design/2026-11-27-tournaments.md §5.1).
    podiumCount: z.number().int(),
})
export type OrgRegistryRow = z.infer<typeof OrgRegistryRowSchema>

// One published podium («Турниры» in the person panel).
export const OrgRegistryPodiumSchema = z.object({
    tournamentTitle: z.string(),
    // The event's local date.
    date: z.iso.date(),
    divisionName: z.string(),
    place: z.number().int(),
})
