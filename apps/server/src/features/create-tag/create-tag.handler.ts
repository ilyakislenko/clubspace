import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TagService } from '../../domains/video/services/tag.service'
import { CreateTagFeature, CreateTagFeatureResponse } from './create-tag.feature'

@Feature(CreateTagFeature)
export class CreateTagHandler
    implements IFeatureHandler<CreateTagFeature, CreateTagFeatureResponse>
{
    constructor(private readonly tagService: TagService) {}

    async execute({ payload, workspaceId }: CreateTagFeature) {
        const tag = await this.tagService.createTag({
            workspaceId,
            data: payload,
        })

        return {
            ...tag,
            createdAt: tag.createdAt.toISOString(),
            updatedAt: tag.updatedAt.toISOString(),
        }
    }
}
