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
})
export type OrgRegistryRow = z.infer<typeof OrgRegistryRowSchema>
