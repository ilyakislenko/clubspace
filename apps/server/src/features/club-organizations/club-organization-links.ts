import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import type { FilesService } from '../../infrastructure/files/services/files.service'
import type { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    CLUB_ORG_LINK_SELECT,
    type ClubOrganizationLink,
    type ClubOrgLinkRow,
    serializeClubOrganizationLink,
} from './schemas'

// One of this club's links (any status). Another club's link is «not found».
export const findClubOrganizationLink = async (
    prisma: Pick<PrismaService, 'organizationClub'>,
    workspaceId: string,
    linkId: string,
): Promise<ClubOrgLinkRow> => {
    const row = await prisma.organizationClub.findFirst({
        where: { id: linkId, workspaceId },
        select: CLUB_ORG_LINK_SELECT,
    })
    if (!row) throw new NotFoundError({ message: 'Приглашение федерации не найдено' })
    return row
}

export const presentClubOrganizationLink = async (
    files: FilesService,
    row: ClubOrgLinkRow,
    canAccept: boolean,
): Promise<ClubOrganizationLink> =>
    serializeClubOrganizationLink(row, {
        logoUrl: await signClubLogoUrl(files, row.organization.logoKey),
        canAccept,
    })
