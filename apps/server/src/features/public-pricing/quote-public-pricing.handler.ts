import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../environments/environment'
import {
    QuotePublicPricingFeature,
    QuotePublicPricingFeatureResponse,
} from './public-pricing.feature'
import { quotePublicPricing } from './public-pricing-utils'

// Public: the landing's calculator. Reads no club data — the inputs are all
// the visitor's.
@Feature(QuotePublicPricingFeature)
export class QuotePublicPricingHandler
    implements
        IFeatureHandler<
            QuotePublicPricingFeature,
            QuotePublicPricingFeatureResponse
        >
{
    async execute(f: QuotePublicPricingFeature) {
        return quotePublicPricing(
            environment.billing.pricing,
            f.payload,
            new Date(),
        )
    }
}
