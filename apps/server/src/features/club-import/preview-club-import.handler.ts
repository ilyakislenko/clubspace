import { InjectQueue } from '@nestjs/bullmq'
import { Feature, IFeatureHandler } from '@shelfjs/features'
import type { Queue } from 'bullmq'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CLUB_IMPORT_FIELD_LABELS,
    type ClubImportFieldKey,
} from './club-import-fields'
import {
    type ClubImportFeatureResponse,
    PreviewClubImportFeature,
} from './club-import.feature'
import { CLUB_IMPORT_ADMIN_MESSAGE, findClubImport } from './club-import-access'
import { CLUB_IMPORT_QUEUE, startClubImportRun } from './club-import.processor'
import { serializeClubImport } from './schemas'

// Saves the confirmed mapping and options and starts the dry run in the
// background. Can be re-run with another mapping until the import is applied.
@Feature(PreviewClubImportFeature)
export class PreviewClubImportHandler
    implements IFeatureHandler<PreviewClubImportFeature, ClubImportFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        @InjectQueue(CLUB_IMPORT_QUEUE) private readonly queue: Queue,
    ) {}

    async execute(f: PreviewClubImportFeature): Promise<ClubImportFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            CLUB_IMPORT_ADMIN_MESSAGE,
        )
        const current = await findClubImport(this.prisma, f.workspaceId, f.importId)
        const width = (current.headers as string[]).length

        const mapping = Object.fromEntries(
            Object.entries(f.payload.mapping).filter(([, v]) => v !== undefined),
        ) as Partial<Record<ClubImportFieldKey, number>>
        const seen = new Map<number, ClubImportFieldKey>()
        for (const [key, column] of Object.entries(mapping) as [ClubImportFieldKey, number][]) {
            if (column >= width) {
                throw new BadRequestError({
                    message: `«${CLUB_IMPORT_FIELD_LABELS[key]}»: в файле нет колонки №${column + 1}`,
                })
            }
            const other = seen.get(column)
            if (other) {
                throw new BadRequestError({
                    message: `Колонка «${(current.headers as string[])[column]}» выбрана и для «${CLUB_IMPORT_FIELD_LABELS[other]}», и для «${CLUB_IMPORT_FIELD_LABELS[key]}»`,
                })
            }
            seen.set(column, key)
        }
        if (
            mapping.email === undefined &&
            mapping.fullName === undefined &&
            mapping.firstname === undefined &&
            mapping.lastname === undefined
        ) {
            throw new BadRequestError({
                message: 'Укажите хотя бы колонку с ФИО, именем или e-mail',
            })
        }

        await startClubImportRun(this.prisma, this.queue, {
            importId: f.importId,
            workspaceId: f.workspaceId,
            mode: 'preview',
            from: ['UPLOADED', 'PREVIEWED', 'FAILED'],
            data: {
                mapping,
                createMissing: f.payload.createMissing,
                overwrite: f.payload.overwrite,
            },
        })
        return serializeClubImport(
            await findClubImport(this.prisma, f.workspaceId, f.importId),
        )
    }
}
