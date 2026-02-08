import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CategoryService } from '../../domains/video/services/category.service'
import {
    DeleteCategoryFeature,
    DeleteCategoryFeatureResponse,
} from './delete-category.feature'

@Feature(DeleteCategoryFeature)
export class DeleteCategoryHandler
    implements
        IFeatureHandler<DeleteCategoryFeature, DeleteCategoryFeatureResponse>
{
    constructor(private readonly categoryService: CategoryService) {}

    async execute({ workspaceId, categoryId }: DeleteCategoryFeature) {
        await this.categoryService.deleteCategory({
            workspaceId,
            categoryId,
        })

        return { status: 'deleted' as const }
    }
}
