import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TagService } from '../../domains/video/services/tag.service'
import { ListTagsFeature, ListTagsFeatureResponse } from './list-tags.feature'

@Feature(ListTagsFeature)
export class ListTagsHandler
    implements IFeatureHandler<ListTagsFeature, ListTagsFeatureResponse>
{
    constructor(private readonly tagService: TagService) {}

    async execute({ payload, workspaceId }: ListTagsFeature) {
        const data = await this.tagService.listTags({
            workspaceId,
            type: payload.type,
        })

        return {
            data: data.map((tag) => ({
                ...tag,
                createdAt: tag.createdAt.toISOString(),
                updatedAt: tag.updatedAt.toISOString(),
            })),
        }
    }
}
