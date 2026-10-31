import { GetVideoFeatureResponse } from './get-video.feature'

// Member-facing video detail (the app's video screen). Unlike the admin
// get-video, it runs the course access gate: a student only opens a video
// they could play.
export class GetWorkspaceVideoFeature {
    constructor(
        readonly workspaceId: string,
        readonly videoId: string,
        readonly invokerUserId: string,
    ) {}
}

export type GetWorkspaceVideoFeatureResponse = GetVideoFeatureResponse
