import { Feature, IFeatureHandler } from '@shelfjs/features'

import { WebPushClient } from '../../domains/notifications/services/web-push.client'
import {
    GetWebPushConfigFeature,
    GetWebPushConfigFeatureResponse,
} from './web-push-subscriptions.feature'

@Feature(GetWebPushConfigFeature)
export class GetWebPushConfigHandler
    implements IFeatureHandler<GetWebPushConfigFeature, GetWebPushConfigFeatureResponse>
{
    constructor(private readonly webPush: WebPushClient) {}

    async execute() {
        return { publicKey: this.webPush.publicKey }
    }
}
