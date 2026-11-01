import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../environments/environment'
import {
    GetPublicPricingFeature,
    GetPublicPricingFeatureResponse,
} from './public-pricing.feature'
import { publicPricingView } from './public-pricing-utils'

// Public: the landing reads it before anyone has an account.
@Feature(GetPublicPricingFeature)
export class GetPublicPricingHandler
    implements
        IFeatureHandler<GetPublicPricingFeature, GetPublicPricingFeatureResponse>
{
    async execute() {
        const { billing } = environment
        return publicPricingView(billing.pricing, billing.trialDays)
    }
}
