// Federation ladder standards (design docs/design/2026-11-26-federation-hub-mvp.md
// §2, §3.3): a template is copied into a club ladder with provenance
// (`RankLadder.templateId/templateVersion`, `RankLevel.templateLevelId`) and
// no live link. The org sees only which active member club adopted which
// version — read here, so org features never query club tables themselves.
import type { PrismaService } from '../../infrastructure/prisma'

export type TemplateAdoption = { clubId: string; clubName: string; version: number }

// Per template: the active member clubs holding a copy, with the newest
// version each copied, by club name.
export const loadTemplateAdoptions = async (
    prisma: Pick<PrismaService, 'rankLadder' | 'organizationClub'>,
    organizationId: string,
    templateIds: string[],
): Promise<Map<string, TemplateAdoption[]>> => {
    const result = new Map<string, TemplateAdoption[]>()
    if (templateIds.length === 0) return result
    const ladders = await prisma.rankLadder.findMany({
        where: {
            templateId: { in: templateIds },
            workspace: {
                organizationLinks: { some: { organizationId, status: 'ACTIVE' } },
            },
        },
        select: {
            templateId: true,
            templateVersion: true,
            workspaceId: true,
            workspace: { select: { name: true } },
        },
    })
    const best = new Map<string, TemplateAdoption & { templateId: string }>()
    for (const l of ladders) {
        if (!l.templateId) continue
        const key = `${l.templateId}:${l.workspaceId}`
        const version = l.templateVersion ?? 1
        const seen = best.get(key)
        if (!seen || seen.version < version) {
            best.set(key, {
                templateId: l.templateId,
                clubId: l.workspaceId,
                clubName: l.workspace.name,
                version,
            })
        }
    }
    for (const { templateId, ...adoption } of best.values()) {
        const list = result.get(templateId) ?? []
        list.push(adoption)
        result.set(templateId, list)
    }
    for (const list of result.values()) {
        list.sort((a, b) => a.clubName.localeCompare(b.clubName, 'ru'))
    }
    return result
}
