import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'
import { OrgNotifierService } from '../../domains/organizations/org-notifier.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    CreatePlatformOrganizationFeature,
    CreatePlatformOrganizationFeatureResponse,
} from './create-organization.feature'
import { PLATFORM_ORG_SELECT, serializePlatformOrganization } from './list-organizations.handler'
import {
    isValidWorkspaceKey,
    nextAvailableKey,
    normalizeEmail,
    slugifyWorkspaceKey,
} from './platform-utils'

const isP2002 = (e: unknown): boolean => (e as { code?: string })?.code === 'P2002'

// The workspace key rules (2–50 chars, a–z 0–9 - _): an explicit key must be
// free, a derived one is suffixed past collisions.
const resolveOrganizationKey = async (
    prisma: Pick<PrismaService, 'organization'>,
    name: string,
    requested?: string,
): Promise<string> => {
    const explicit = requested?.trim()
    if (explicit) {
        if (!isValidWorkspaceKey(explicit)) {
            throw new BadRequestError({
                message: 'Ключ: 2–50 символов, строчные латинские буквы, цифры, «-» или «_»',
            })
        }
        const taken = await prisma.organization.findUnique({
            where: { key: explicit },
            select: { id: true },
        })
        if (taken) throw new BadRequestError({ message: `Ключ «${explicit}» уже занят` })
        return explicit
    }
    const base = slugifyWorkspaceKey(name)
    if (!isValidWorkspaceKey(base)) {
        throw new BadRequestError({
            message: 'Не удалось построить ключ из названия — задайте ключ вручную',
        })
    }
    const siblings = await prisma.organization.findMany({
        where: { key: { startsWith: base } },
        select: { key: true },
    })
    return nextAvailableKey(
        base,
        siblings.map((s) => s.key),
    )
}

@Feature(CreatePlatformOrganizationFeature)
export class CreatePlatformOrganizationHandler
    implements
        IFeatureHandler<CreatePlatformOrganizationFeature, CreatePlatformOrganizationFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly notifier: OrgNotifierService,
    ) {}

    async execute(f: CreatePlatformOrganizationFeature) {
        assertPlatformAdmin(f.isSuperAdmin)
        assertOrganizationsEnabled()

        const { name, type, city, timezone } = f.payload
        const adminEmail = normalizeEmail(f.payload.adminEmail)
        const key = await resolveOrganizationKey(this.prisma, name, f.payload.key)
        const existingAdmin = await this.prisma.user.findUnique({
            where: { email: adminEmail },
            select: { id: true, status: true },
        })
        if (existingAdmin && existingAdmin.status !== 'ACTIVE') {
            throw new BadRequestError({ message: 'Аккаунт администратора заблокирован или удалён' })
        }

        let created: { orgId: string; adminId: string }
        try {
            created = await this.prisma.$transaction(async (tx) => {
                const adminId =
                    existingAdmin?.id ??
                    (
                        await tx.user.create({
                            data: { email: adminEmail, status: 'ACTIVE', language: 'RU' },
                            select: { id: true },
                        })
                    ).id
                const org = await tx.organization.create({
                    data: {
                        key,
                        name,
                        type,
                        city: city || null,
                        ...(timezone ? { timezone } : {}),
                    },
                    select: { id: true },
                })
                await tx.organizationMember.create({
                    data: {
                        organizationId: org.id,
                        userId: adminId,
                        role: 'ORG_ADMIN',
                        invitedById: f.invokerUserId,
                    },
                })
                return { orgId: org.id, adminId }
            })
        } catch (e) {
            if (!isP2002(e)) throw e
            throw new BadRequestError({ message: `Ключ «${key}» уже занят` })
        }

        const adminNotified = await this.notifier.notifyMemberAdded({
            userId: created.adminId,
            organization: { id: created.orgId, name },
            role: 'ORG_ADMIN',
        })
        await this.audit.record({
            action: 'org.create',
            targetType: 'organization',
            targetId: created.orgId,
            organizationId: created.orgId,
            workspaceId: null,
            actorId: f.invokerUserId,
            metadata: { key, name, userId: created.adminId, adminCreated: !existingAdmin },
        })

        const org = await this.prisma.organization.findUniqueOrThrow({
            where: { id: created.orgId },
            select: PLATFORM_ORG_SELECT,
        })
        return {
            organization: serializePlatformOrganization(org),
            adminCreated: !existingAdmin,
            adminNotified,
        }
    }
}
