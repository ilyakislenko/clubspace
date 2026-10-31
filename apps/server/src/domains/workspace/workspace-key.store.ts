import {
    isValidWorkspaceKey,
    nextAvailableKey,
    slugifyWorkspaceKey,
} from '../../features/platform/platform-utils'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'

// A new club's key. An explicit key is taken at face value (and must be free);
// a derived one is suffixed past collisions, so "create another Gracie Barra"
// doesn't make anyone invent a key by hand. `fallbackBase` is for callers that
// cannot ask for a key (the self-serve wizard): a name with no usable
// characters ("…") gets that base instead of an error.
export const resolveWorkspaceKey = async (
    prisma: Pick<PrismaService, 'workspace'>,
    name: string,
    requestedKey?: string,
    fallbackBase?: string,
): Promise<string> => {
    const explicit = requestedKey?.trim()

    if (explicit) {
        if (!isValidWorkspaceKey(explicit)) {
            throw new BadRequestError({
                message:
                    'Ключ: 2–50 символов, строчные латинские буквы, цифры, «-» или «_»',
            })
        }
        const taken = await prisma.workspace.findUnique({
            where: { key: explicit },
            select: { id: true },
        })
        if (taken) {
            throw new BadRequestError({
                message: `Ключ «${explicit}» уже занят`,
            })
        }
        return explicit
    }

    const slug = slugifyWorkspaceKey(name)
    const base = isValidWorkspaceKey(slug) ? slug : (fallbackBase ?? slug)
    if (!isValidWorkspaceKey(base)) {
        throw new BadRequestError({
            message:
                'Не удалось построить ключ из названия — задайте ключ вручную',
        })
    }

    const siblings = await prisma.workspace.findMany({
        where: { key: { startsWith: base } },
        select: { key: true },
    })
    return nextAvailableKey(
        base,
        siblings.map((s) => s.key),
    )
}
