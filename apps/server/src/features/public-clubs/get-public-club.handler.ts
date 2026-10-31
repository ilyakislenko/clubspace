import { Feature, IFeatureHandler } from '@shelfjs/features'

import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { normalizeJoinCode } from '../../domains/workspace/join-code'
import {
    isValidPublicSlug,
    normalizePublicSlug,
} from '../../domains/workspace/public-slug'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetPublicClubFeature,
    GetPublicClubFeatureResponse,
} from './get-public-club.feature'
import { publicClubSelect, serializePublicClub } from './schemas'

@Feature(GetPublicClubFeature)
export class GetPublicClubHandler
    implements IFeatureHandler<GetPublicClubFeature, GetPublicClubFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute({ lookup, today }: GetPublicClubFeature) {
        const select = publicClubSelect(today)

        if (lookup.kind === 'code') {
            // Malformed, unknown, rotated-away and deactivated codes all answer
            // the same 404, so a guesser learns nothing about how close they got.
            const code = normalizeJoinCode(lookup.code)
            const row = code
                ? await this.prisma.workspaceJoinCode.findUnique({
                      where: { code },
                      select: { workspace: { select } },
                  })
                : null
            const ws = row?.workspace
            if (!code || !ws || !ws.isActive) {
                throw new NotFoundError({
                    message: 'Клуб с таким кодом не найден',
                })
            }
            return serializePublicClub(ws, {
                logoUrl: await signClubLogoUrl(this.files, ws.logoKey),
                joinCode: code,
            })
        }

        const slug = normalizePublicSlug(lookup.slug)
        const row = isValidPublicSlug(slug)
            ? await this.prisma.workspacePublicSlug.findUnique({
                  where: { slug },
                  select: { workspace: { select } },
              })
            : null
        const ws = row?.workspace
        // An unlisted club has no public page: the same 404 as no club at all.
        if (!ws || !ws.isActive || !ws.isListed) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }
        return serializePublicClub(ws, {
            logoUrl: await signClubLogoUrl(this.files, ws.logoKey),
            joinCode: ws.joinCodeRow?.code ?? null,
        })
    }
}
