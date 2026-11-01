import { z } from 'zod'

import { APP_FEATURE_KEYS, type AppFeatureKey } from './feature-flags'

// Platform locks on a club's app-section switches (WorkspaceFeatureLock).
// The platform owner pins `<feature>Enabled` on or off, optionally through a
// date; while the lock holds the club's admin cannot change that switch. An
// expired lock is simply ignored (the club has the switch back, the column
// keeps the pinned value); unlocking deletes the row.

export type FeatureLockRow = {
    feature: string
    enabled: boolean
    until: Date | null
}

export type FeatureLock = {
    feature: AppFeatureKey
    enabled: boolean
    until: Date | null
}

export const FeatureLockSchema = z.object({
    feature: z.enum(APP_FEATURE_KEYS),
    enabled: z.boolean(),
    // null = until the platform unlocks it.
    until: z.iso.datetime().nullable(),
})

export type FeatureLockDto = z.infer<typeof FeatureLockSchema>

const isFeatureKey = (v: string): v is AppFeatureKey =>
    (APP_FEATURE_KEYS as readonly string[]).includes(v)

// Prisma `where` for the locks still in force at `now`.
export const activeFeatureLockWhere = (now: Date) => ({
    OR: [{ until: null }, { until: { gt: now } }],
})

// The locks in force at `now`, in the canonical feature order.
export const activeFeatureLocks = (
    rows: FeatureLockRow[],
    now: Date,
): FeatureLock[] =>
    APP_FEATURE_KEYS.flatMap((feature) => {
        const row = rows.find((r) => r.feature === feature)
        if (!row || !isFeatureKey(row.feature)) return []
        if (row.until && row.until <= now) return []
        return [{ feature, enabled: row.enabled, until: row.until }]
    })

export const serializeFeatureLock = (lock: FeatureLock): FeatureLockDto => ({
    feature: lock.feature,
    enabled: lock.enabled,
    until: lock.until?.toISOString() ?? null,
})

// The locked switches a club settings patch (`<feature>Enabled` fields) would
// change. Re-sending the pinned value is not a change.
export const lockedFlagChanges = (
    patch: Partial<Record<`${AppFeatureKey}Enabled`, boolean>>,
    locks: FeatureLock[],
): FeatureLock[] =>
    locks.filter((lock) => {
        const next = patch[`${lock.feature}Enabled`]
        return next !== undefined && next !== lock.enabled
    })

// Section names as the club's settings page shows them, for error messages.
const FEATURE_LABEL: Record<AppFeatureKey, string> = {
    announcements: 'Объявления',
    ranks: 'Ранги',
    leaderboard: 'Рейтинг посещаемости',
    attendance: 'Посещаемость',
    subscription: 'Абонемент',
    schedule: 'Расписание',
    groups: 'Группы и залы',
    events: 'События',
    guestVisits: 'Гостевые визиты в другие группы',
    videos: 'Видео и курсы',
    achievements: 'Достижения',
    journal: 'Дневник тренировок',
}

// «Раздел «Видео и курсы» установлен платформой — …» for the refused patch.
export const lockedFlagMessage = (locks: FeatureLock[]): string => {
    const names = locks.map((l) => `«${FEATURE_LABEL[l.feature]}»`).join(', ')
    return locks.length > 1
        ? `Разделы ${names} установлены платформой — изменить их может только ClubSpace`
        : `Раздел ${names} установлен платформой — изменить его может только ClubSpace`
}
