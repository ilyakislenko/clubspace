import { Feature, IFeatureHandler } from '@shelfjs/features'

import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    PUBLIC_CLUBS_DEFAULT_PER_PAGE,
    SearchPublicClubsFeature,
    SearchPublicClubsFeatureResponse,
} from './search-public-clubs.feature'

// Only listed, active clubs. A club opts in from «Публичная страница»;
// everything else is invisible here. Queried from the slug table, so every
// hit has the public address the result links to.
const LISTED = { isListed: true, isActive: true } as const

@Feature(SearchPublicClubsFeature)
export class SearchPublicClubsHandler
    implements
        IFeatureHandler<SearchPublicClubsFeature, SearchPublicClubsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute({ payload }: SearchPublicClubsFeature) {
        const curPage = payload.curPage ?? 1
        const perPage = payload.perPage ?? PUBLIC_CLUBS_DEFAULT_PER_PAGE
        const insensitive = 'insensitive' as const

        const workspace = {
            ...LISTED,
            ...(payload.type ? { type: payload.type } : {}),
            ...(payload.city
                ? { city: { equals: payload.city, mode: insensitive } }
                : {}),
            ...(payload.q
                ? {
                      OR: [
                          { name: { contains: payload.q, mode: insensitive } },
                          { city: { contains: payload.q, mode: insensitive } },
                      ],
                  }
                : {}),
        }

        const [rows, total, cityRows] = await Promise.all([
            this.prisma.workspacePublicSlug.findMany({
                where: { workspace },
                select: {
                    slug: true,
                    workspace: {
                        select: {
                            name: true,
                            type: true,
                            city: true,
                            publicDescription: true,
                            logoKey: true,
                        },
                    },
                },
                orderBy: [{ workspace: { name: 'asc' } }, { slug: 'asc' }],
                skip: (curPage - 1) * perPage,
                take: perPage,
            }),
            this.prisma.workspacePublicSlug.count({ where: { workspace } }),
            this.prisma.workspace.findMany({
                where: {
                    ...LISTED,
                    city: { not: null },
                    publicSlugRow: { isNot: null },
                },
                select: { city: true },
                distinct: ['city'],
                orderBy: { city: 'asc' },
            }),
        ])

        const data = await Promise.all(
            rows.map(async ({ slug, workspace: w }) => ({
                slug,
                name: w.name,
                type: w.type,
                city: w.city,
                description: w.publicDescription,
                logoUrl: await signClubLogoUrl(this.files, w.logoKey),
            })),
        )

        return {
            data,
            total,
            curPage,
            perPage,
            cities: cityRows.flatMap((r) => (r.city ? [r.city] : [])),
        }
    }
}
