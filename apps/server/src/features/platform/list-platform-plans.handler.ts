import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { environment } from '../../environments/environment'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { serializePlatformPlan } from '../workspace-billing/schemas'
import {
    ListPlatformPlansFeature,
    ListPlatformPlansFeatureResponse,
} from './list-platform-plans.feature'

@Feature(ListPlatformPlansFeature)
export class ListPlatformPlansHandler
    implements
        IFeatureHandler<ListPlatformPlansFeature, ListPlatformPlansFeatureResponse>
{
    constructor(private readonly billing: PlatformBillingService) {}

    async execute(f: ListPlatformPlansFeature) {
        assertPlatformAdmin(f.isSuperAdmin)
        const plans = await this.billing.listPlans()
        return {
            billingEnabled: this.billing.enabled,
            trialDays: environment.billing.trialDays,
            graceDays: environment.billing.graceDays,
            data: plans.map(serializePlatformPlan),
        }
    }
}
