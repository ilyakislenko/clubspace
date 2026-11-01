import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import {
    BILLING_LIFECYCLE_QUEUE,
    BillingLifecycleProcessor,
} from './billing-lifecycle.processor'
import { BillingLifecycleService } from './services/billing-lifecycle.service'
import { ModuleEntitlementService } from './services/module-entitlement.service'
import { PlatformBillingService } from './services/platform-billing.service'
import { TrialLimitsService } from './services/trial-limits.service'

// Platform billing of clubs: active-member tiers, paid-module entitlements,
// video metering, the quote, and the trial → past due → suspended lifecycle.
// AuditService comes from the global AuditModule.
@Module({
    imports: [
        PrismaModule,
        BullModule.registerQueue({ name: BILLING_LIFECYCLE_QUEUE }),
    ],
    providers: [
        PlatformBillingService,
        ModuleEntitlementService,
        TrialLimitsService,
        BillingLifecycleService,
        BillingLifecycleProcessor,
    ],
    exports: [
        PlatformBillingService,
        ModuleEntitlementService,
        TrialLimitsService,
        BillingLifecycleService,
    ],
})
export class BillingModule {}
