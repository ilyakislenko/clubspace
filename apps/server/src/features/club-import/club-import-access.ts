import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'

export const CLUB_IMPORT_ADMIN_MESSAGE =
    'Импортировать клуб может только администратор или главный тренер'

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
