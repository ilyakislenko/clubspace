import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    GetPublicLegalFeature,
    GetPublicLegalFeatureResponse,
} from './get-public-legal.feature'
import { serializePublicLegal } from './schemas'

@Feature(GetPublicLegalFeature)
export class GetPublicLegalHandler
    implements IFeatureHandler<GetPublicLegalFeature, GetPublicLegalFeatureResponse>
{
    async execute(): Promise<GetPublicLegalFeatureResponse> {
        return serializePublicLegal()
    }
}
