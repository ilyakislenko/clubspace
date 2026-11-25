import { AuditService } from '../../../domains/audit/services/audit.service'
import { loadTemplateAdoptions } from '../../../domains/organizations/templates'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { ORG_TEMPLATE_INCLUDE, serializeOrgLadderTemplate } from './schemas'

// The template of this org, or 404.
export const findOrgTemplate = async (
    prisma: Pick<PrismaService, 'organizationLadderTemplate'>,
    organizationId: string,
    templateId: string,
): Promise<{ id: string; name: string }> => {
    const t = await prisma.organizationLadderTemplate.findFirst({
        where: { id: templateId, organizationId },
        select: { id: true, name: true },
    })
    if (!t) throw new NotFoundError({ message: 'Стандарт не найден' })
    return t
}

// The template as the console shows it after a write, audited.
export const respondWithTemplate = async (
    prisma: PrismaService,
    audit: AuditService,
    p: {
        organizationId: string
        templateId: string
        actorId: string
        action: 'org.templateCreate' | 'org.templateUpdate'
        metadata: Record<string, unknown>
    },
) => {
    const t = await prisma.organizationLadderTemplate.findUniqueOrThrow({
        where: { id: p.templateId },
        include: ORG_TEMPLATE_INCLUDE,
    })
    await audit.record({
        action: p.action,
        targetType: 'organizationTemplate',
        targetId: t.id,
        organizationId: p.organizationId,
        actorId: p.actorId,
        metadata: { name: t.name, version: t.version, ...p.metadata },
    })
    const adoptions = await loadTemplateAdoptions(prisma, p.organizationId, [t.id])
    return serializeOrgLadderTemplate(t, adoptions.get(t.id) ?? [])
}
