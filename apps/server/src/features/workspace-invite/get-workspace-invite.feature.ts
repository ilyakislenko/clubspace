import { WorkspaceInviteSchema, type WorkspaceInviteOutput } from './schemas'

export const GetWorkspaceInviteFeatureOutputSchema = WorkspaceInviteSchema

export class GetWorkspaceInviteFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetWorkspaceInviteFeatureResponse = WorkspaceInviteOutput
