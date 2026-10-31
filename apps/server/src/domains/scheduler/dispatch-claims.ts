import type { PrismaService } from '../../infrastructure/prisma'

type DispatchLogClient = Pick<PrismaService, 'notificationDispatchLog'>

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002'

/**
 * Claims many (kind, refId) dedupe keys in one INSERT … ON CONFLICT DO
 * NOTHING and returns the refIds this call won. A concurrent run, or an
 * earlier one, already holds the rest — so each fan-out ships exactly once.
 */
export const claimDispatchMany = async (
    prisma: DispatchLogClient,
    kind: string,
    refIds: string[],
): Promise<Set<string>> => {
    if (refIds.length === 0) return new Set()
    const won = await prisma.notificationDispatchLog.createManyAndReturn({
        data: refIds.map((refId) => ({ kind, refId })),
        skipDuplicates: true,
        select: { refId: true },
    })
    return new Set(won.map((r) => r.refId))
}

/** Single-key claim; false when it was already taken. */
export const claimDispatch = async (
    prisma: DispatchLogClient,
    kind: string,
    refId: string,
): Promise<boolean> => {
    try {
        await prisma.notificationDispatchLog.create({ data: { kind, refId } })
        return true
    } catch (e) {
        if (isP2002(e)) return false
        throw e
    }
}

export const releaseDispatch = async (
    prisma: DispatchLogClient,
    kind: string,
    refId: string,
): Promise<void> => {
    await prisma.notificationDispatchLog.deleteMany({ where: { kind, refId } })
}
