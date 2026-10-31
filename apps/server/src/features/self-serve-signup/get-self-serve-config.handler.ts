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
        const trialPlan = billing.plans.find(
            (p) => p.code === billing.trialPlanCode,
        )
        return {
            enabled: billing.selfServeSignupEnabled,
            trialDays: billing.trialDays,
            trialPlanName: trialPlan?.name ?? billing.trialPlanCode,
        }
    }
}
