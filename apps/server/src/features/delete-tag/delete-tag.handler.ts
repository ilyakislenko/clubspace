import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TagService } from '../../domains/video/services/tag.service'
import { DeleteTagFeature, DeleteTagFeatureResponse } from './delete-tag.feature'

@Feature(DeleteTagFeature)
export class DeleteTagHandler
    implements IFeatureHandler<DeleteTagFeature, DeleteTagFeatureResponse>
{
    constructor(private readonly tagService: TagService) {}

    async execute({ workspaceId, tagId }: DeleteTagFeature) {
        await this.tagService.deleteTag({
            workspaceId,
            tagId,
        })

        return { status: 'deleted' as const }
    }
}
