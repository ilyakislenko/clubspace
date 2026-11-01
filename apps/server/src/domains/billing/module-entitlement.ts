import { environment } from '../../environments/environment'
import type { BillingStatus } from './billing-rules'
import type { PlatformModuleCode } from './platform-pricing.config'

export type ModuleMode = 'PAID' | 'COMP' | 'OFF'

// Why a module is on or off for a club:
//  PAID / COMP — on the bill / granted free until compUntil;
//  TRIAL       — the trial turns every module on (no row needed);
//  OFF         — switched off by the platform, even during the trial;
//  NONE        — never bought, or the comp ran out after the trial;
//  SELF_HOSTED — PLATFORM_BILLING_ENABLED=false: everything is on.
export type ModuleEntitlementSource =
    | 'PAID'
    | 'COMP'
    | 'TRIAL'
    | 'OFF'
    | 'NONE'
    | 'SELF_HOSTED'

export type ModuleEntitlementRow = {
    module: PlatformModuleCode
    mode: ModuleMode
    compUntil: Date | null
}

export type EntitlementBilling = {
    status: BillingStatus
} | null

export const moduleEntitlement = (
    row: Pick<ModuleEntitlementRow, 'mode' | 'compUntil'> | null | undefined,
    billing: EntitlementBilling,
    now: Date = new Date(),
    billingEnabled: boolean = environment.billing.enabled,
): { entitled: boolean; source: ModuleEntitlementSource } => {
    if (!billingEnabled) return { entitled: true, source: 'SELF_HOSTED' }
    if (row?.mode === 'OFF') return { entitled: false, source: 'OFF' }
    if (row?.mode === 'PAID') return { entitled: true, source: 'PAID' }
    if (row?.mode === 'COMP' && row.compUntil && row.compUntil > now) {
        return { entitled: true, source: 'COMP' }
    }
    // A club without a billing row is one the next read starts a trial for
    // (PlatformBillingService.getBilling).
    if (!billing || billing.status === 'TRIAL') {
        return { entitled: true, source: 'TRIAL' }
    }
    return { entitled: false, source: 'NONE' }
}

// Prisma `select` fragment for a Workspace: what moduleEntitlement needs for
// one module, so a gate that already reads the workspace pays no extra query.
export const moduleEntitlementSelect = (module: PlatformModuleCode) =>
    ({
        billing: { select: { status: true } },
        moduleEntitlements: {
            where: { module },
            select: { mode: true, compUntil: true },
        },
    }) as const

export type ModuleEntitlementWorkspace = {
    billing: { status: BillingStatus } | null
    moduleEntitlements: { mode: ModuleMode; compUntil: Date | null }[]
}

export const isWorkspaceEntitled = (
    workspace: ModuleEntitlementWorkspace,
    now: Date = new Date(),
): boolean =>
    moduleEntitlement(workspace.moduleEntitlements[0], workspace.billing, now)
        .entitled

export const MODULE_NOT_ENTITLED_MESSAGE: Record<PlatformModuleCode, string> = {
    VIDEO: 'Модуль «Видео» не подключён: загрузка видео и новые курсы недоступны. Подключить модуль можно в разделе «Тариф».',
    ONLINE_PAYMENTS:
        'Модуль «Онлайн-оплата» не подключён: оплата абонементов в приложении недоступна. Подключить модуль можно в разделе «Тариф».',
    BRANDED_APP: 'Модуль «Приложение под брендом клуба» не подключён.',
}

// What a student sees when the club's VIDEO module is not entitled.
export const VIDEO_UNAVAILABLE_FOR_MEMBERS =
    'Видео в этом клубе сейчас недоступны. Обратитесь к администратору клуба.'
