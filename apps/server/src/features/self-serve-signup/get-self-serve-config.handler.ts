import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../environments/environment'
import {
    GetSelfServeConfigFeature,
    GetSelfServeConfigFeatureResponse,
} from './get-self-serve-config.feature'

@Feature(GetSelfServeConfigFeature)
export class GetSelfServeConfigHandler
    implements
        IFeatureHandler<
            GetSelfServeConfigFeature,
            GetSelfServeConfigFeatureResponse
        >
{
    async execute() {
        const { billing } = environment
        return {
            enabled: billing.selfServeSignupEnabled,
            trialDays: billing.trialDays,
            offerVersion: billing.legal.offerVersion,
            dpaVersion: billing.legal.dpaVersion,
        }
    }
}
