import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import type { MyClubMessageOutput } from './schemas'

// A member's own copies in «Сообщения клуба» (the person the request acts
// for: a guardian acting as a child reads the child's). Only sent messages.
export const myRecipientWhere = (
    workspaceId: string,
    userId: string,
): Prisma.ClubMessageRecipientWhereInput => ({
    workspaceId,
    userId,
    message: { status: 'SENT' },
})

export const myRecipientSelect = {
    readAt: true,
    message: {
        select: { id: true, title: true, body: true, authorName: true, sentAt: true },
    },
} as const satisfies Prisma.ClubMessageRecipientSelect

type MyRecipientRow = Prisma.ClubMessageRecipientGetPayload<{ select: typeof myRecipientSelect }>

export type ClubCard = { name: string; logoUrl: string | null }

export const loadClubCard = async (
    prisma: Pick<PrismaService, 'workspace'>,
    files: FilesService,
    workspaceId: string,
): Promise<ClubCard> => {
    const ws = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { name: true, logoKey: true },
    })
    return { name: ws.name, logoUrl: await signClubLogoUrl(files, ws.logoKey) }
}

export const serializeMyClubMessage = (r: MyRecipientRow, club: ClubCard): MyClubMessageOutput => ({
    id: r.message.id,
    title: r.message.title,
    body: r.message.body,
    authorName: r.message.authorName,
    // A SENT message always has sentAt.
    sentAt: (r.message.sentAt ?? new Date(0)).toISOString(),
    readAt: r.readAt?.toISOString() ?? null,
    club,
})

export const loadMyRecipient = async (
    prisma: Pick<PrismaService, 'clubMessageRecipient'>,
    p: { workspaceId: string; userId: string; messageId: string },
): Promise<MyRecipientRow> => {
    const row = await prisma.clubMessageRecipient.findFirst({
        where: { ...myRecipientWhere(p.workspaceId, p.userId), messageId: p.messageId },
        select: myRecipientSelect,
    })
    if (!row) throw new NotFoundError({ message: 'Сообщение не найдено' })
    return row
}
