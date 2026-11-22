import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListMyAutopaysFeature,
    ListMyAutopaysFeatureResponse,
} from './list-my-autopays.feature'
import { loadAutopayViews } from './member-autopay-view'
import { serializeMyAutopay } from './schemas'

// Any member, own rows only; works after access ran out and with the
// abonement section off, so a refusal is never blocked.
@Feature(ListMyAutopaysFeature)
export class ListMyAutopaysHandler
    implements IFeatureHandler<ListMyAutopaysFeature, ListMyAutopaysFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: ListMyAutopaysFeature): Promise<ListMyAutopaysFeatureResponse> {
        const views = await loadAutopayViews(this.prisma, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            now: new Date(),
        })
        return { data: views.map(serializeMyAutopay) }
    }
}
