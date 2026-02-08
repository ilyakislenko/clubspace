import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CategoryService } from '../../domains/video/services/category.service'
import {
    UpdateCategoryFeature,
    UpdateCategoryFeatureResponse,
} from './update-category.feature'

@Feature(UpdateCategoryFeature)
export class UpdateCategoryHandler
    implements
        IFeatureHandler<UpdateCategoryFeature, UpdateCategoryFeatureResponse>
{
    constructor(private readonly categoryService: CategoryService) {}

    async execute({ payload, workspaceId, categoryId }: UpdateCategoryFeature) {
        const category = await this.categoryService.updateCategory({
            workspaceId,
            categoryId,
            data: payload,
        })

        return {
            ...category,
            createdAt: category.createdAt.toISOString(),
            updatedAt: category.updatedAt.toISOString(),
        }
    }
}
