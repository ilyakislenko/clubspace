import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import {
    BILLING_LIFECYCLE_QUEUE,
    BillingLifecycleProcessor,
} from './billing-lifecycle.processor'
import { BillingLifecycleService } from './services/billing-lifecycle.service'
import { PlatformBillingService } from './services/platform-billing.service'

// Platform billing of clubs: plans, usage limits, the trial → past due →
// suspended lifecycle. AuditService comes from the global AuditModule.
@Module({
    imports: [
        PrismaModule,
        BullModule.registerQueue({ name: BILLING_LIFECYCLE_QUEUE }),
    ],
    providers: [
        PlatformBillingService,
        BillingLifecycleService,
        BillingLifecycleProcessor,
    ],
    exports: [PlatformBillingService, BillingLifecycleService],
})
export class BillingModule {}
