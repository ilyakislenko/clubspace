import { z } from 'zod'

import type { TemplateAdoption } from '../../../domains/organizations/templates'

export const OrgLadderTemplateLevelOutputSchema = z.object({
    id: z.string().uuid(),
    templateId: z.string().uuid(),
    name: z.string(),
    order: z.number().int(),
    color: z.string().nullable(),
    maxStripes: z.number().int(),
    requirements: z.string().nullable(),
    minVisits: z.number().int().nullable(),
    minWeeks: z.number().int().nullable(),
})

export const OrgLadderTemplateOutputSchema = z.object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    name: z.string(),
    audience: z.string().nullable(),
    // +1 on every level change; a club copy remembers the version it took.
    version: z.number().int(),
    isActive: z.boolean(),
    levels: z.array(OrgLadderTemplateLevelOutputSchema),
    // «Принят в клубах: ACADEMY (v2), Беркут (v1)» — active member clubs only.
    adoptions: z.array(
        z.object({
            clubId: z.string().uuid(),
            clubName: z.string(),
            version: z.number().int(),
        }),
    ),
    updatedAt: z.iso.datetime(),
})
export type OrgLadderTemplateOutput = z.infer<typeof OrgLadderTemplateOutputSchema>

// Level fields shared by create (template or level) and update.
export const TemplateLevelFields = {
    name: z.string().trim().min(1).max(255),
    order: z.number().int().min(0).max(1000),
    color: z.string().trim().max(16).nullable().optional(),
    maxStripes: z.number().int().min(0).max(20).optional(),
    requirements: z.string().trim().max(5000).nullable().optional(),
    minVisits: z.number().int().min(1).max(5000).nullable().optional(),
    minWeeks: z.number().int().min(1).max(520).nullable().optional(),
}

export const ORG_TEMPLATE_INCLUDE = {
    levels: { orderBy: { order: 'asc' } },
} as const

type LevelRow = {
    id: string
    templateId: string
    name: string
    order: number
    color: string | null
    maxStripes: number
    requirements: string | null
    minVisits: number | null
    minWeeks: number | null
}

export const serializeOrgLadderTemplate = (
    t: {
        id: string
        organizationId: string
        name: string
        audience: string | null
        version: number
        isActive: boolean
        updatedAt: Date
        levels: LevelRow[]
    },
    adoptions: TemplateAdoption[],
): OrgLadderTemplateOutput => ({
    id: t.id,
    organizationId: t.organizationId,
    name: t.name,
    audience: t.audience,
    version: t.version,
    isActive: t.isActive,
    levels: t.levels.map((l) => ({
        id: l.id,
        templateId: l.templateId,
        name: l.name,
        order: l.order,
        color: l.color,
        maxStripes: l.maxStripes,
        requirements: l.requirements,
        minVisits: l.minVisits,
        minWeeks: l.minWeeks,
    })),
    adoptions,
    updatedAt: t.updatedAt.toISOString(),
})

export const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'
