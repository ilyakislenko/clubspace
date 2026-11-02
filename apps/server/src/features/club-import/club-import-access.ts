import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import type { ClubVocabulary } from '../../shared/utils/club-vocabulary'

export const CLUB_IMPORT_ADMIN_MESSAGE = (v: ClubVocabulary): string =>
    `Импортировать клуб может только администратор или ${v.headCoach.nom}`

// An import of THIS club — another club's id reads as not found.
export const findClubImport = async (
    prisma: PrismaService,
    workspaceId: string,
    importId: string,
) => {
    const row = await prisma.clubImport.findFirst({
        where: { id: importId, workspaceId },
    })
    if (!row) throw new NotFoundError({ message: 'Импорт не найден' })
    return row
}
