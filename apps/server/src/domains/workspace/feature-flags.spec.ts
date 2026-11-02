import {
    APP_FEATURE_KEYS,
    defaultFeatureColumnsFor,
    toAppFeatureFlags,
} from './feature-flags'

// A club on its trial: every module entitled.
const trial = { billing: { status: 'TRIAL' as const }, moduleEntitlements: [] }

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

describe('toAppFeatureFlags', () => {
    it('maps each <key>Enabled column to its public key value', () => {
        expect(
            toAppFeatureFlags({
                ...trial,
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
        expect(Object.keys(toAppFeatureFlags({ ...allColumns, ...trial })).sort()).toEqual(
            [...APP_FEATURE_KEYS].sort(),
        )
    })

    // The paid VIDEO module gates the club's own switch: the app hides videos
    // while it is not entitled, and shows them again once it is.
    it('turns videos off while the VIDEO module is not entitled', () => {
        const active = { billing: { status: 'ACTIVE' as const } }
        expect(
            toAppFeatureFlags({ ...allColumns, ...active, moduleEntitlements: [] }).videos,
        ).toBe(false)
        expect(
            toAppFeatureFlags({
                ...allColumns,
                ...active,
                moduleEntitlements: [{ mode: 'PAID', compUntil: null }],
            }).videos,
        ).toBe(true)
        expect(
            toAppFeatureFlags({
                ...allColumns,
                ...trial,
                moduleEntitlements: [{ mode: 'OFF', compUntil: null }],
            }).videos,
        ).toBe(false)
    })
})

describe('defaultFeatureColumnsFor', () => {
    it('keeps everything on for a grappling club', () => {
        expect(defaultFeatureColumnsFor('GRAPPLING')).toEqual({
            ranksEnabled: true,
            videosEnabled: true,
            achievementsEnabled: true,
            journalEnabled: true,
        })
    })

    it('starts a dance studio with videos but without ranks and journal', () => {
        expect(defaultFeatureColumnsFor('DANCE')).toEqual({
            ranksEnabled: false,
            videosEnabled: true,
            achievementsEnabled: true,
            journalEnabled: false,
        })
    })

    it.each(['FITNESS', 'YOGA', 'CUSTOM'])(
        'starts a %s club without ranks, videos and journal',
        (type) => {
            expect(defaultFeatureColumnsFor(type)).toEqual({
                ranksEnabled: false,
                videosEnabled: false,
                achievementsEnabled: true,
                journalEnabled: false,
            })
        },
    )
})
