import { PrismaService } from '../../infrastructure/prisma'
import {
    NotFoundError,
    UnexpectedError,
} from '../../shared/errors/shared.errors'
import { generateJoinCode } from './join-code'

const MAX_ATTEMPTS = 5

const errorCode = (e: unknown): string | undefined =>
    typeof e === 'object' && e !== null
        ? (e as { code?: string }).code
        : undefined

const isP2002 = (e: unknown): boolean => errorCode(e) === 'P2002'
// P2003: foreign key (no such club); P2025: nothing to update.
const isMissingClub = (e: unknown): boolean =>
    errorCode(e) === 'P2003' || errorCode(e) === 'P2025'

const clubNotFound = () => new NotFoundError({ message: 'Клуб не найден' })

// The club's join code, assigned the first time anyone needs it (existing
// clubs have no row, so there is nothing to backfill).
export const ensureJoinCode = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<string> => {
    const existing = await prisma.workspaceJoinCode.findUnique({
        where: { workspaceId },
        select: { code: true },
    })
    if (existing) return existing.code

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const code = generateJoinCode()
        try {
            await prisma.workspaceJoinCode.create({
                data: { workspaceId, code },
            })
            return code
        } catch (e) {
            if (isMissingClub(e)) throw clubNotFound()
            if (!isP2002(e)) throw e
            // Either the workspaceId key collided (a concurrent first call
            // won: take its code) or the code is already another club's
            // (draw again). A re-read tells the two apart.
            const winner = await prisma.workspaceJoinCode.findUnique({
                where: { workspaceId },
                select: { code: true },
            })
            if (winner) return winner.code
        }
    }
    throw new UnexpectedError({
        message: 'Не удалось создать код клуба, попробуйте ещё раз',
    })
}

// Replaces the club's code (the old one stops working on the spot).
export const rotateJoinCode = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<string> => {
    await ensureJoinCode(prisma, workspaceId)

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const code = generateJoinCode()
        try {
            await prisma.workspaceJoinCode.update({
                where: { workspaceId },
                data: { code },
            })
            return code
        } catch (e) {
            if (isMissingClub(e)) throw clubNotFound()
            // The code is already taken by another club: draw again.
            if (!isP2002(e)) throw e
        }
    }
    throw new UnexpectedError({
        message: 'Не удалось создать код клуба, попробуйте ещё раз',
    })
}
