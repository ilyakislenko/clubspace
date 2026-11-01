// What a trial may cost ClubSpace, and the pure rules behind it (unit-tested
// in trial-limits.spec.ts). The owner's rule: a club costs us money only
// during its trial, so the trial is bounded — video storage and viewing are
// capped, the branded app is not part of it, and the e-mails the club sends to
// people are counted against an allowance. Sign-in codes are never counted:
// they are not the club's mail (they go to an address, not on its behalf).

import { addDays, BYTES_PER_GB, type BillingStatus } from './billing-rules'
import type { ModuleEntitlementSource } from './module-entitlement'
import type { PlatformModuleCode } from './platform-pricing.config'

export type TrialLimits = {
    // VIDEO during the trial: stored in total, and watched per calendar month.
    videoStorageGb: number
    videoViewHoursPerMonth: number
    // E-mails the club may send to people over the whole trial.
    emails: number
}

// The modules the trial turns on. BRANDED_APP is a store build the platform
// makes by hand, so it is never part of the trial: it is bought or granted.
export const TRIAL_MODULES: readonly PlatformModuleCode[] = ['VIDEO', 'ONLINE_PAYMENTS']

export const isTrialModule = (code: PlatformModuleCode): boolean =>
    TRIAL_MODULES.includes(code)

export const TRIAL_LIMIT_CTA = 'Оплатите тариф, чтобы снять ограничение.'

const GB = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export const trialStorageMessage = (limitGb: number, usedBytes: number): string =>
    `В пробном периоде можно хранить до ${GB.format(limitGb)} ГБ видео, загружено ${GB.format(
        usedBytes / BYTES_PER_GB,
    )} ГБ — этот файл не помещается. ${TRIAL_LIMIT_CTA}`

export const trialViewingMessage = (limitHours: number): string =>
    `В пробном периоде доступно ${limitHours} ч просмотра видео в месяц — лимит этого месяца исчерпан. ${TRIAL_LIMIT_CTA}`

type TrialRow = {
    status: BillingStatus
    currentPeriodEnd: Date | null
}

// The trial's caps are in force: billing is on, the club is on its trial and
// has not paid a period yet (paying early lifts them; so does the platform
// granting VIDEO for free — its source is then COMP, not TRIAL).
export const trialCapsApply = (
    row: TrialRow | null,
    now: Date,
    billingEnabled: boolean,
): boolean => {
    if (!billingEnabled) return false
    // No row yet = the first read starts a trial (PlatformBillingService.getBilling).
    if (!row) return true
    if (row.status !== 'TRIAL') return false
    return !(row.currentPeriodEnd && row.currentPeriodEnd > now)
}

export const videoTrialCapsApply = (
    row: TrialRow | null,
    videoSource: ModuleEntitlementSource,
    now: Date,
    billingEnabled: boolean,
): boolean => videoSource === 'TRIAL' && trialCapsApply(row, now, billingEnabled)

// Whether an upload of `incomingBytes` fits next to what the club already
// stores. An upload without a declared size is refused only once the cap is
// reached; completeUpload measures the real size.
export const fitsTrialStorage = (
    storedBytes: number,
    incomingBytes: number | undefined,
    limitGb: number,
): boolean => {
    const cap = limitGb * BYTES_PER_GB
    return incomingBytes === undefined
        ? storedBytes < cap
        : storedBytes + incomingBytes <= cap
}

export const withinTrialViewing = (
    viewedSecondsThisMonth: number,
    limitHours: number,
): boolean => viewedSecondsThisMonth < limitHours * 3600

// «23,28» → [23, 28]: the trial days (counted from the trial's start) on
// which the owner is reminded. Each must fall inside the trial.
export const parseTrialReminderDays = (raw: string, trialDays: number): number[] => {
    const days = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
    for (const d of days) {
        if (!Number.isInteger(d) || d < 1 || d >= trialDays) {
            throw new Error(
                `PLATFORM_TRIAL_REMINDER_DAYS: «${raw}» — each day must be a whole number from 1 to ${trialDays - 1}`,
            )
        }
    }
    return [...new Set(days)].sort((a, b) => a - b)
}

// The reminder of `day` for a trial ending at `trialEndsAt`: day N of a
// T-day trial falls T - N days before its end, so a trial the console
// extended is reminded relative to its new end.
export const trialReminderAt = (
    trialEndsAt: Date,
    day: number,
    trialDays: number,
): Date => addDays(trialEndsAt, -(trialDays - day))

// The reminder due now: the latest configured day whose moment has passed
// while the trial still runs. Earlier days that are also past are skipped
// (one message, not a burst, for a trial that started late in its schedule).
export const dueTrialReminder = (
    trialEndsAt: Date,
    days: number[],
    trialDays: number,
    now: Date,
): { day: number; passed: number[] } | null => {
    if (trialEndsAt <= now) return null
    const passed = days.filter((d) => trialReminderAt(trialEndsAt, d, trialDays) <= now)
    if (passed.length === 0) return null
    return { day: passed[passed.length - 1], passed }
}

export type TrialCostRates = {
    // Rubles: a GB stored for a month, an hour watched, an e-mail sent, an
    // active member served for a month.
    storageGbMonth: number
    viewHour: number
    email: number
    activeMemberMonth: number
}

export type TrialUsage = {
    activeMembers: number
    emailsSent: number
    storageBytes: number
    viewedSeconds: number
    // Days of the trial so far (whole trial once it ended).
    days: number
}

// What a club's trial cost ClubSpace so far, in whole rubles: storage and
// members per month of trial, viewing per hour, e-mails each.
export const estimateTrialCost = (usage: TrialUsage, rates: TrialCostRates): number => {
    const months = Math.max(0, usage.days) / 30
    const cost =
        (usage.storageBytes / BYTES_PER_GB) * rates.storageGbMonth * months +
        (usage.viewedSeconds / 3600) * rates.viewHour +
        usage.emailsSent * rates.email +
        usage.activeMembers * rates.activeMemberMonth * months
    return Math.round(cost)
}
