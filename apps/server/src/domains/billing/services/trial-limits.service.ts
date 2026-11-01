import { Injectable } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import { PrismaService } from '../../../infrastructure/prisma'
import { TrialLimitReachedError } from '../../../shared/errors/shared.errors'
import { BYTES_PER_GB } from '../billing-rules'
import {
    moduleEntitlement,
    moduleEntitlementSelect,
    VIDEO_UNAVAILABLE_FOR_MEMBERS,
} from '../module-entitlement'
import {
    fitsTrialStorage,
    trialCapsApply,
    trialStorageMessage,
    trialViewingMessage,
    videoTrialCapsApply,
    withinTrialViewing,
} from '../trial-limits'
import { PlatformBillingService } from './platform-billing.service'

// Enforces the trial's caps (trial-limits.ts) where the cost arises: a video
// upload, a playback link, an e-mail the club sends to someone. Each check is
// one indexed read of the club's billing row and VIDEO entitlement; a paid or
// self-hosted club passes without further queries.
@Injectable()
export class TrialLimitsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly billing: PlatformBillingService,
    ) {}

    private get limits() {
        return environment.billing.trial
    }

    // Whether the VIDEO caps hold for the club right now.
    private async videoCapped(workspaceId: string, now: Date): Promise<boolean> {
        if (!this.billing.enabled) return false
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: {
                ...moduleEntitlementSelect('VIDEO'),
                billing: { select: { status: true, currentPeriodEnd: true } },
            },
        })
        if (!workspace) return false
        const { source } = moduleEntitlement(
            workspace.moduleEntitlements[0],
            workspace.billing,
            now,
            this.billing.enabled,
        )
        return videoTrialCapsApply(workspace.billing, source, now, this.billing.enabled)
    }

    // What the club stores and may still store during its trial; null = no cap.
    async trialStorage(
        workspaceId: string,
        now = new Date(),
    ): Promise<{ storedBytes: number; remainingBytes: number } | null> {
        if (!(await this.videoCapped(workspaceId, now))) return null
        const storedBytes = await this.billing.storageBytes(workspaceId)
        return {
            storedBytes,
            remainingBytes: Math.max(0, this.limits.videoStorageGb * BYTES_PER_GB - storedBytes),
        }
    }

    // Refuses an upload that would take a trial club past the storage cap.
    async assertCanUploadVideo(
        workspaceId: string,
        sizeBytes: number | undefined,
        now = new Date(),
    ): Promise<void> {
        if (!(await this.videoCapped(workspaceId, now))) return
        const stored = await this.billing.storageBytes(workspaceId)
        if (fitsTrialStorage(stored, sizeBytes, this.limits.videoStorageGb)) return
        throw new TrialLimitReachedError({
            limit: 'VIDEO_STORAGE',
            message: trialStorageMessage(this.limits.videoStorageGb, stored),
        })
    }

    // The error completeUpload raises for a file that did not fit after all
    // (a client that declared no size, or two uploads racing).
    storageExceededError(workspaceStoredBytes: number): TrialLimitReachedError {
        return new TrialLimitReachedError({
            limit: 'VIDEO_STORAGE',
            message: trialStorageMessage(this.limits.videoStorageGb, workspaceStoredBytes),
        })
    }

    // Refuses a playback link once a trial club watched its monthly hours:
    // staff are told why and how to lift it, students get a neutral message.
    async assertCanPlayVideo(
        workspaceId: string,
        isStaff: boolean,
        now = new Date(),
    ): Promise<void> {
        if (!(await this.videoCapped(workspaceId, now))) return
        const viewed = await this.billing.viewedSeconds(workspaceId, now)
        if (withinTrialViewing(viewed, this.limits.videoViewHoursPerMonth)) return
        throw new TrialLimitReachedError(
            isStaff
                ? {
                      limit: 'VIDEO_VIEWING',
                      message: trialViewingMessage(this.limits.videoViewHoursPerMonth),
                  }
                : { limit: null, message: VIDEO_UNAVAILABLE_FOR_MEMBERS },
        )
    }

    // Takes one e-mail from a trial club's allowance; false = the allowance
    // is spent and the e-mail must not go out. Outside the trial nothing is
    // counted. The increment is conditional in SQL, so two invitations sent
    // at once can never both take the last slot.
    async consumeTrialEmail(workspaceId: string, now = new Date()): Promise<boolean> {
        if (!this.billing.enabled) return true
        const row = await this.billing.getBilling(workspaceId)
        if (!trialCapsApply(row, now, true)) return true
        const taken = await this.prisma.workspaceBilling.updateMany({
            where: {
                workspaceId,
                status: 'TRIAL',
                trialEmailsSent: { lt: this.limits.emails },
            },
            data: { trialEmailsSent: { increment: 1 } },
        })
        return taken.count === 1
    }
}
