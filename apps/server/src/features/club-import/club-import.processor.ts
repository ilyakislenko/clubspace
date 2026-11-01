import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'

import { PrismaService } from '../../infrastructure/prisma'
import { ConflictError, NotFoundError } from '../../shared/errors/shared.errors'
import { ClubImportEngine, type ClubImportMode } from './club-import.engine'

export const CLUB_IMPORT_QUEUE = 'club-import'

export type ClubImportJob = { importId: string; mode: ClubImportMode }

// A run whose worker died (deploy mid-import) stops blocking the club after
// this long without progress; re-running is safe — the import is idempotent.
const STALE_RUN_MS = 15 * 60 * 1000

// Previews and applies run here, not in the request: a 5 000-row file takes
// a while, and the wizard polls processed/total.
@Processor(CLUB_IMPORT_QUEUE, { concurrency: 2 })
export class ClubImportProcessor extends WorkerHost {
    private readonly logger = new Logger(ClubImportProcessor.name)

    constructor(
        private readonly engine: ClubImportEngine,
        private readonly prisma: PrismaService,
    ) {
        super()
    }

    async process(job: Job<ClubImportJob>): Promise<void> {
        const { importId, mode } = job.data
        try {
            await this.engine.run(importId, mode)
        } catch (error) {
            this.logger.error(`club import ${importId} (${mode}) failed`, error as Error)
            await this.prisma.clubImport.updateMany({
                where: { id: importId },
                data: {
                    status: 'FAILED',
                    error:
                        mode === 'apply'
                            ? 'Импорт прервался. Уже сохранённые строки останутся; загрузите файл ещё раз — повторный импорт не создаст дублей'
                            : 'Проверка прервалась — попробуйте ещё раз',
                },
            })
        }
    }
}

// Moves the run into PREVIEWING/APPLYING (only from the given states, so a
// double click can't start it twice) and queues it. One run per club at a
// time: two imports racing over the same names would both create «Дети 7–10».
export const startClubImportRun = async (
    prisma: PrismaService,
    queue: Queue,
    p: {
        importId: string
        workspaceId: string
        mode: ClubImportMode
        from: Array<'UPLOADED' | 'PREVIEWED' | 'FAILED'>
        data?: { mapping: object; createMissing: boolean; overwrite: boolean }
    },
): Promise<void> => {
    const row = await prisma.clubImport.findFirst({
        where: { id: p.importId, workspaceId: p.workspaceId },
        select: { id: true, rows: true },
    })
    if (!row) throw new NotFoundError({ message: 'Импорт не найден' })

    const busy = await prisma.clubImport.findFirst({
        where: {
            workspaceId: p.workspaceId,
            status: { in: ['PREVIEWING', 'APPLYING'] },
            updatedAt: { gt: new Date(Date.now() - STALE_RUN_MS) },
        },
        select: { id: true },
    })
    if (busy) {
        throw new ConflictError({
            message: 'Сейчас идёт другой импорт этого клуба — дождитесь его окончания',
        })
    }

    const moved = await prisma.clubImport.updateMany({
        where: { id: p.importId, status: { in: p.from } },
        data: {
            status: p.mode === 'apply' ? 'APPLYING' : 'PREVIEWING',
            processed: 0,
            total: (row.rows as unknown[]).length,
            error: null,
            ...(p.data ?? {}),
        },
    })
    if (moved.count !== 1) {
        throw new ConflictError({
            message:
                p.mode === 'apply'
                    ? 'Применить можно только после проверки — запустите проверку ещё раз'
                    : 'Этот импорт уже применён или выполняется — загрузите файл заново',
        })
    }
    try {
        await queue.add(
            'run',
            { importId: p.importId, mode: p.mode } satisfies ClubImportJob,
            { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
        )
    } catch (error) {
        await prisma.clubImport.update({
            where: { id: p.importId },
            data: { status: 'FAILED', error: 'Не удалось запустить импорт — попробуйте ещё раз' },
        })
        throw error
    }
}
