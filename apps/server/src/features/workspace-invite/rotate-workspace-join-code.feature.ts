import { WorkspaceInviteSchema, type WorkspaceInviteOutput } from './schemas'

export const RotateWorkspaceJoinCodeFeatureOutputSchema = WorkspaceInviteSchema

export class RotateWorkspaceJoinCodeFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type RotateWorkspaceJoinCodeFeatureResponse = WorkspaceInviteOutput
