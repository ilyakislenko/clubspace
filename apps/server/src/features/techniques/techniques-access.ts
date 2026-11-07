import type { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import type { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import { type SportType, type Technique, techniquesFor } from '@clubspace/sport-glossary'

/**
 * What «Техники» reads for a member: the club sport's catalogue and the ready
 * lessons they may watch (staff: all). After the membership gate.
 */
export async function loadTechniqueScope(
    prisma: PrismaService,
    courseAccess: CourseAccessService,
    p: { userId: string; workspaceId: string },
): Promise<{ techniques: readonly Technique[]; videoIds: string[] }> {
    await assertActiveWorkspaceMembership(prisma, p.userId, p.workspaceId)
    const workspace = await prisma.workspace.findUnique({
        where: { id: p.workspaceId },
        select: { type: true },
    })
    const techniques = workspace ? techniquesFor(workspace.type as SportType) : []
    if (techniques.length === 0) return { techniques, videoIds: [] }
    const ready = await prisma.video.findMany({
        where: { workspaceId: p.workspaceId, status: 'ready' },
        select: { id: true },
    })
    const watchable = await courseAccess.watchableVideoIds(
        p.workspaceId,
        p.userId,
        ready.map((v) => v.id),
    )
    return { techniques, videoIds: [...watchable] }
}
