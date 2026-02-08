import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CategoryService } from '../../domains/video/services/category.service'
import {
    ListCategoriesFeature,
    ListCategoriesFeatureResponse,
} from './list-categories.feature'

@Feature(ListCategoriesFeature)
export class ListCategoriesHandler
    implements
        IFeatureHandler<ListCategoriesFeature, ListCategoriesFeatureResponse>
{
    constructor(private readonly categoryService: CategoryService) {}

    async execute({ payload, workspaceId }: ListCategoriesFeature) {
        const data = await this.categoryService.listCategories({
            workspaceId,
            parentId: payload.parentId,
        })

        return {
            data: data.map((category) => ({
                ...category,
                createdAt: category.createdAt.toISOString(),
                updatedAt: category.updatedAt.toISOString(),
            })),
        }
    }
}
