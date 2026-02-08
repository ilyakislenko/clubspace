import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CategoryService } from '../../domains/video/services/category.service'
import {
    CreateCategoryFeature,
    CreateCategoryFeatureResponse,
} from './create-category.feature'

@Feature(CreateCategoryFeature)
export class CreateCategoryHandler
    implements
        IFeatureHandler<CreateCategoryFeature, CreateCategoryFeatureResponse>
{
    constructor(private readonly categoryService: CategoryService) {}

    async execute({ payload, workspaceId }: CreateCategoryFeature) {
        const category = await this.categoryService.createCategory({
            workspaceId,
            data: payload,
        })

        return {
            ...category,
            createdAt: category.createdAt.toISOString(),
            updatedAt: category.updatedAt.toISOString(),
        }
    }
}
