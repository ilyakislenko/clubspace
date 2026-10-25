import { PrismaService } from '../../infrastructure/prisma'
import { serializeGradingDetail, type RankGradingDetailOutput } from './schemas'

// One read for every grading response that returns the full session.
export const loadGradingDetail = async (
    prisma: Pick<PrismaService, 'rankGrading'>,
    workspaceId: string,
    gradingId: string,
): Promise<RankGradingDetailOutput | null> => {
    const grading = await prisma.rankGrading.findFirst({
        where: { id: gradingId, workspaceId },
        include: {
            ladder: { select: { name: true } },
            gym: { select: { id: true, name: true } },
            candidates: {
                include: {
                    user: {
                        select: { firstname: true, lastname: true, email: true },
                    },
                    level: { select: { name: true, color: true } },
                },
            },
        },
    })
    return grading ? serializeGradingDetail(grading) : null
}
