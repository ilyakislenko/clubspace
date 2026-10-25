import { PrismaService } from '../../infrastructure/prisma'
import {
    NotFoundError,
    UnexpectedError,
} from '../../shared/errors/shared.errors'
import { generateJoinCode } from './join-code'

const MAX_ATTEMPTS = 5

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// The club's join code, assigned the first time anyone needs it (existing
// clubs have none, so there is nothing to backfill).
export const ensureJoinCode = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<string> => {
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { joinCode: true },
    })
    if (!workspace) {
        throw new NotFoundError({ message: 'Клуб не найден' })
    }
    if (workspace.joinCode) return workspace.joinCode

    return assignNewJoinCode(prisma, workspaceId, { onlyIfNull: true })
}

// Writes a fresh code (rotation replaces the old one on the spot). With
// `onlyIfNull` it only fills an empty slot, so two first-time callers can't
// overwrite each other: the loser re-reads the winner's code.
export const assignNewJoinCode = async (
    prisma: PrismaService,
    workspaceId: string,
    opts: { onlyIfNull?: boolean } = {},
): Promise<string> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const joinCode = generateJoinCode()
        try {
            const { count } = await prisma.workspace.updateMany({
                where: {
                    id: workspaceId,
                    ...(opts.onlyIfNull ? { joinCode: null } : {}),
                },
                data: { joinCode },
            })
            if (count > 0) return joinCode
            if (opts.onlyIfNull) {
                const current = await prisma.workspace.findUnique({
                    where: { id: workspaceId },
                    select: { joinCode: true },
                })
                if (current?.joinCode) return current.joinCode
            }
            throw new NotFoundError({ message: 'Клуб не найден' })
        } catch (e) {
            // The code is already taken by another club: draw again.
            if (!isP2002(e)) throw e
        }
    }
    throw new UnexpectedError({
        message: 'Не удалось создать код клуба, попробуйте ещё раз',
    })
}
