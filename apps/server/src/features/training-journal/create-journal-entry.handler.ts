import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    CreateJournalEntryFeature,
    CreateJournalEntryFeatureResponse,
} from './create-journal-entry.feature'
import { serializeEntry } from './schemas'

@Feature(CreateJournalEntryFeature)
export class CreateJournalEntryHandler
    implements
        IFeatureHandler<
            CreateJournalEntryFeature,
            CreateJournalEntryFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: CreateJournalEntryFeature) {
        // Date-only column: anchor the chosen day (or today) at UTC midnight.
        const day = f.payload.entryDate ?? new Date().toISOString().slice(0, 10)
        const entry = await this.prisma.trainingJournalEntry.create({
            data: {
                workspaceId: f.workspaceId,
                userId: f.userId,
                entryDate: new Date(`${day}T00:00:00.000Z`),
                body: f.payload.body.trim(),
            },
        })
        return serializeEntry(entry)
    }
}
