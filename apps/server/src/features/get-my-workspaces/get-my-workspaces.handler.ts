import { Feature, IFeatureHandler } from '@shelfjs/features'

import { WorkspaceService } from '../../domains/workspace/services/workspace.service'
import {
    GetMyWorkspacesFeature,
    GetMyWorkspacesFeatureResponse,
} from './get-my-workspaces.feature'

@Feature(GetMyWorkspacesFeature)
export class GetMyWorkspacesHandler
    implements
        IFeatureHandler<GetMyWorkspacesFeature, GetMyWorkspacesFeatureResponse>
{
    constructor(private workspaceService: WorkspaceService) {}

    async execute({ payload, user }: GetMyWorkspacesFeature) {
        const workspaces = await this.workspaceService.getWorkspaces({
            userId: user.userId,
            curPage: payload.curPage,
            perPage: payload.perPage,
        })

        return workspaces
    }
}
