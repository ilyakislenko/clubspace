import { APP_FEATURE_KEYS, toFeatureFlags } from './feature-flags'

const allColumns = {
    announcementsEnabled: true,
    ranksEnabled: true,
    leaderboardEnabled: true,
    attendanceEnabled: true,
    subscriptionEnabled: true,
    scheduleEnabled: true,
    groupsEnabled: true,
    eventsEnabled: true,
    guestVisitsEnabled: true,
}

describe('toFeatureFlags', () => {
    it('maps each <key>Enabled column to its public key value', () => {
        expect(
            toFeatureFlags({
                announcementsEnabled: true,
                ranksEnabled: false,
                leaderboardEnabled: true,
                attendanceEnabled: false,
                subscriptionEnabled: true,
                scheduleEnabled: false,
                groupsEnabled: true,
                eventsEnabled: false,
                guestVisitsEnabled: true,
            }),
        ).toEqual({
            announcements: true,
            ranks: false,
            leaderboard: true,
            attendance: false,
            subscription: true,
            schedule: false,
            groups: true,
            events: false,
            guestVisits: true,
        })
    })

    it('emits exactly the canonical feature keys', () => {
        expect(Object.keys(toFeatureFlags(allColumns)).sort()).toEqual(
            [...APP_FEATURE_KEYS].sort(),
        )
    })
})
