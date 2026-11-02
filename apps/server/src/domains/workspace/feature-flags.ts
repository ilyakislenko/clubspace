import { z } from 'zod'

import {
    isWorkspaceEntitled,
    type ModuleEntitlementWorkspace,
    moduleEntitlementSelect,
} from '../billing/module-entitlement'

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

// Column row -> the club's own switches as `{ announcements: bool, ... }`
// (what the club chose, before the paid-module gate below).
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

// What the member app actually gets: the club's switches, with the sections
// of paid platform modules off while the module is not entitled (videos needs
// VIDEO). Select with appFeatureSelect.
export const appFeatureSelect = {
    ...featureFlagSelect,
    ...moduleEntitlementSelect('VIDEO'),
}

export const toAppFeatureFlags = (
    w: FeatureFlagColumns & ModuleEntitlementWorkspace,
    now: Date = new Date(),
): AppFeatureFlags => {
    const flags = toFeatureFlags(w)
    return { ...flags, videos: flags.videos && isWorkspaceEntitled(w, now) }
}

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

// Column defaults a NEW club starts with, by club type. Ranks (belts and
// gradings), the video library and the training journal come from martial
// arts: a GRAPPLING club keeps everything on, other clubs start without ranks.
// A dance studio keeps videos — choreography clips are its main content; a
// fitness / yoga / custom club starts without videos and the journal. Every
// section can be switched on later in the settings. Existing clubs are
// untouched (the columns default to true).
export const defaultFeatureColumnsFor = (
    type: string,
): Pick<
    FeatureFlagColumns,
    'ranksEnabled' | 'videosEnabled' | 'achievementsEnabled' | 'journalEnabled'
> => {
    if (type === 'GRAPPLING') {
        return {
            ranksEnabled: true,
            videosEnabled: true,
            achievementsEnabled: true,
            journalEnabled: true,
        }
    }
    return {
        ranksEnabled: false,
        videosEnabled: type === 'DANCE',
        achievementsEnabled: true,
        journalEnabled: false,
    }
}
