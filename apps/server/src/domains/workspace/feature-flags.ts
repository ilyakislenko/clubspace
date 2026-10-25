import { z } from 'zod'

/**
 * Canonical app-section feature flags. Each key maps 1:1 to a Boolean column on
 * Workspace (`<key>Enabled`) and to a whole block in the member mobile app, so
 * a club can hide features that overcomplicate the app early on. All default
 * ON — the club opts specific blocks OUT from the admin.
 *
 * Adding a feature = add the column (schema), a key here, and a mobile gate.
 * The generated contract carries the shape to the admin + app automatically.
 */
export const APP_FEATURE_KEYS = [
    'announcements',
    'ranks',
    'leaderboard',
    'attendance',
    'subscription',
    'schedule',
    'groups',
    'events',
    'guestVisits',
    'videos',
    'achievements',
    'journal',
] as const

export type AppFeatureKey = (typeof APP_FEATURE_KEYS)[number]
export type AppFeatureFlags = Record<AppFeatureKey, boolean>

// The Workspace columns backing each flag (`<key>Enabled`).
type FeatureFlagColumns = {
    announcementsEnabled: boolean
    ranksEnabled: boolean
    leaderboardEnabled: boolean
    attendanceEnabled: boolean
    subscriptionEnabled: boolean
    scheduleEnabled: boolean
    groupsEnabled: boolean
    eventsEnabled: boolean
    guestVisitsEnabled: boolean
    videosEnabled: boolean
    achievementsEnabled: boolean
    journalEnabled: boolean
}

// Prisma `select` fragment for every flag column — spread into a workspace
// select so the mapper below has all the fields it needs.
export const featureFlagSelect = {
    announcementsEnabled: true,
    ranksEnabled: true,
    leaderboardEnabled: true,
    attendanceEnabled: true,
    subscriptionEnabled: true,
    scheduleEnabled: true,
    groupsEnabled: true,
    eventsEnabled: true,
    guestVisitsEnabled: true,
    videosEnabled: true,
    achievementsEnabled: true,
    journalEnabled: true,
} as const

// Column row -> the public `{ announcements: bool, ... }` object the app reads.
export const toFeatureFlags = (w: FeatureFlagColumns): AppFeatureFlags => ({
    announcements: w.announcementsEnabled,
    ranks: w.ranksEnabled,
    leaderboard: w.leaderboardEnabled,
    attendance: w.attendanceEnabled,
    subscription: w.subscriptionEnabled,
    schedule: w.scheduleEnabled,
    groups: w.groupsEnabled,
    events: w.eventsEnabled,
    guestVisits: w.guestVisitsEnabled,
    videos: w.videosEnabled,
    achievements: w.achievementsEnabled,
    journal: w.journalEnabled,
})

// Shared Zod schema for the flags object (used by the get-my-workspaces DTO).
export const AppFeatureFlagsSchema = z.object({
    announcements: z.boolean(),
    ranks: z.boolean(),
    leaderboard: z.boolean(),
    attendance: z.boolean(),
    subscription: z.boolean(),
    schedule: z.boolean(),
    groups: z.boolean(),
    events: z.boolean(),
    guestVisits: z.boolean(),
    videos: z.boolean(),
    achievements: z.boolean(),
    journal: z.boolean(),
})

// Flat `<key>Enabled` fields as the admin settings DTO carries them (matching
// the Workspace columns). Reused by get/update-workspace-settings — `.shape`
// spreads them in, `.partial()` makes them all optional for the update input.
export const FeatureFlagColumnsSchema = z.object({
    announcementsEnabled: z.boolean(),
    ranksEnabled: z.boolean(),
    leaderboardEnabled: z.boolean(),
    attendanceEnabled: z.boolean(),
    subscriptionEnabled: z.boolean(),
    scheduleEnabled: z.boolean(),
    groupsEnabled: z.boolean(),
    eventsEnabled: z.boolean(),
    guestVisitsEnabled: z.boolean(),
    videosEnabled: z.boolean(),
    achievementsEnabled: z.boolean(),
    journalEnabled: z.boolean(),
})

// Column defaults a NEW club starts with, by club type. Videos and the training
// journal are martial-arts features (a video library, a technique diary), so a
// fitness / yoga / custom club starts without them; GRAPPLING keeps everything
// on. Existing clubs are untouched (the columns default to true).
export const defaultFeatureColumnsFor = (
    type: string,
): Pick<
    FeatureFlagColumns,
    'videosEnabled' | 'achievementsEnabled' | 'journalEnabled'
> =>
    type === 'GRAPPLING'
        ? {
              videosEnabled: true,
              achievementsEnabled: true,
              journalEnabled: true,
          }
        : {
              videosEnabled: false,
              achievementsEnabled: true,
              journalEnabled: false,
          }
