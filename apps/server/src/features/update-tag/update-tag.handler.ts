import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TagService } from '../../domains/video/services/tag.service'
import { UpdateTagFeature, UpdateTagFeatureResponse } from './update-tag.feature'

@Feature(UpdateTagFeature)
export class UpdateTagHandler
    implements IFeatureHandler<UpdateTagFeature, UpdateTagFeatureResponse>
{
    constructor(private readonly tagService: TagService) {}

    async execute({ payload, workspaceId, tagId }: UpdateTagFeature) {
        const tag = await this.tagService.updateTag({
            workspaceId,
            tagId,
            data: payload,
        })

        return {
            ...tag,
            createdAt: tag.createdAt.toISOString(),
            updatedAt: tag.updatedAt.toISOString(),
        }
    }
}
