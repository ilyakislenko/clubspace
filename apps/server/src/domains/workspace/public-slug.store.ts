import { PrismaService } from '../../infrastructure/prisma'
import {
    NotFoundError,
    UnexpectedError,
} from '../../shared/errors/shared.errors'
import { nextAvailablePublicSlug, slugifyPublicSlug } from './public-slug'

const MAX_ATTEMPTS = 5

const errorCode = (e: unknown): string | undefined =>
    typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string'
        ? e.code
        : undefined

// The club's public slug, generated from its name the first time anyone needs
// it (existing clubs have no row, so there is nothing to backfill). Mirrors
// ensureJoinCode: create, and on a unique clash tell "a concurrent first call
// won" (take its slug) from "the slug is another club's" (pick the next one).
export const ensurePublicSlug = async (
    prisma: PrismaService,
    workspace: { id: string; name: string },
): Promise<string> => {
    const existing = await prisma.workspacePublicSlug.findUnique({
        where: { workspaceId: workspace.id },
        select: { slug: true },
    })
    if (existing) return existing.slug

    const base = slugifyPublicSlug(workspace.name)
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const siblings = await prisma.workspacePublicSlug.findMany({
            where: { slug: { startsWith: base } },
            select: { slug: true },
        })
        const slug = nextAvailablePublicSlug(
            base,
            siblings.map((s) => s.slug),
        )
        try {
            await prisma.workspacePublicSlug.create({
                data: { workspaceId: workspace.id, slug },
            })
            return slug
        } catch (e) {
            const code = errorCode(e)
            if (code === 'P2003') {
                throw new NotFoundError({ message: 'Клуб не найден' })
            }
            if (code !== 'P2002') throw e
            const winner = await prisma.workspacePublicSlug.findUnique({
                where: { workspaceId: workspace.id },
                select: { slug: true },
            })
            if (winner) return winner.slug
        }
    }
    throw new UnexpectedError({
        message: 'Не удалось подобрать адрес страницы, попробуйте ещё раз',
    })
}
