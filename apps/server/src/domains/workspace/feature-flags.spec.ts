import {
    APP_FEATURE_KEYS,
    defaultFeatureColumnsFor,
    toFeatureFlags,
} from './feature-flags'

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
    videosEnabled: true,
    achievementsEnabled: true,
    journalEnabled: true,
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
                videosEnabled: false,
                achievementsEnabled: true,
                journalEnabled: false,
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
            videos: false,
            achievements: true,
            journal: false,
        })
    })

    it('emits exactly the canonical feature keys', () => {
        expect(Object.keys(toFeatureFlags(allColumns)).sort()).toEqual(
            [...APP_FEATURE_KEYS].sort(),
        )
    })
})

describe('defaultFeatureColumnsFor', () => {
    it('keeps everything on for a grappling club', () => {
        expect(defaultFeatureColumnsFor('GRAPPLING')).toEqual({
            videosEnabled: true,
            achievementsEnabled: true,
            journalEnabled: true,
        })
    })

    it.each(['FITNESS', 'YOGA', 'CUSTOM'])(
        'starts a %s club without videos and journal',
        (type) => {
            expect(defaultFeatureColumnsFor(type)).toEqual({
                videosEnabled: false,
                achievementsEnabled: true,
                journalEnabled: false,
            })
        },
    )
})
