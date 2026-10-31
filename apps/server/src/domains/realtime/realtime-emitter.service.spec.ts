import {
    INVALIDATE_COALESCE_MS,
    RealtimeEmitter,
    userRoom,
    workspaceRoom,
} from './realtime-emitter.service'

describe('RealtimeEmitter', () => {
    it('emits an invalidate to the workspace room', () => {
        const emit = jest.fn()
        const to = jest.fn().mockReturnValue({ emit })
        const emitter = new RealtimeEmitter()
        emitter.setServer({ to } as never)

        emitter.invalidate('w1', ['announcements', 'ranks'])

        expect(to).toHaveBeenCalledWith(workspaceRoom('w1'))
        expect(emit).toHaveBeenCalledWith('invalidate', {
            workspaceId: 'w1',
            resources: ['announcements', 'ranks'],
        })
    })

    it('emits a list delta to the workspace room', () => {
        const emit = jest.fn()
        const to = jest.fn().mockReturnValue({ emit })
        const emitter = new RealtimeEmitter()
        emitter.setServer({ to } as never)

        emitter.emitListDelta('w1', 'announcements', 'create', {
            id: 'a1',
            title: 'Hi',
        })

        expect(to).toHaveBeenCalledWith(workspaceRoom('w1'))
        expect(emit).toHaveBeenCalledWith('delta', {
            workspaceId: 'w1',
            list: 'announcements',
            op: 'create',
            item: { id: 'a1', title: 'Hi' },
        })
    })

    it('emits a user-scoped list delta to each user room, tagged "me"', () => {
        const emit = jest.fn()
        const to = jest.fn().mockReturnValue({ emit })
        const emitter = new RealtimeEmitter()
        emitter.setServer({ to } as never)

        emitter.emitListDeltaUsers(['u1'], 'notifications', 'create', {
            id: 'n1',
        })

        expect(to).toHaveBeenCalledWith([userRoom('u1')])
        expect(emit).toHaveBeenCalledWith('delta', {
            workspaceId: 'me',
            list: 'notifications',
            op: 'create',
            item: { id: 'n1' },
        })
    })

    it('emits a user-scoped invalidate to each user room, tagged "me"', () => {
        const emit = jest.fn()
        const to = jest.fn().mockReturnValue({ emit })
        const emitter = new RealtimeEmitter()
        emitter.setServer({ to } as never)

        emitter.invalidateUsers(['u1', 'u2'], ['notifications'])

        expect(to).toHaveBeenCalledWith([userRoom('u1'), userRoom('u2')])
        expect(emit).toHaveBeenCalledWith('invalidate', {
            workspaceId: 'me',
            resources: ['notifications'],
        })
    })

    it('invalidateUsers no-ops with no users', () => {
        const emit = jest.fn()
        const to = jest.fn().mockReturnValue({ emit })
        const emitter = new RealtimeEmitter()
        emitter.setServer({ to } as never)
        emitter.invalidateUsers([], ['notifications'])
        expect(to).not.toHaveBeenCalled()
    })

    it('no-ops before a server is wired in', () => {
        const emitter = new RealtimeEmitter()
        expect(() => emitter.invalidate('w1', ['x'])).not.toThrow()
    })

    it('no-ops when there are no resources', () => {
        const emit = jest.fn()
        const to = jest.fn().mockReturnValue({ emit })
        const emitter = new RealtimeEmitter()
        emitter.setServer({ to } as never)

        emitter.invalidate('w1', [])

        expect(to).not.toHaveBeenCalled()
    })

    describe('invalidateCoalesced', () => {
        beforeEach(() => jest.useFakeTimers())
        afterEach(() => jest.useRealTimers())

        it('merges a burst into one emit per workspace after the window', () => {
            const emit = jest.fn()
            const to = jest.fn().mockReturnValue({ emit })
            const emitter = new RealtimeEmitter()
            emitter.setServer({ to } as never)

            emitter.invalidateCoalesced('w1', ['attendance'])
            emitter.invalidateCoalesced('w1', ['attendance', 'leaderboard'])
            emitter.invalidateCoalesced('w2', ['attendance'])
            expect(emit).not.toHaveBeenCalled()

            jest.advanceTimersByTime(INVALIDATE_COALESCE_MS)

            expect(emit).toHaveBeenCalledTimes(2)
            expect(to).toHaveBeenCalledWith(workspaceRoom('w1'))
            expect(emit).toHaveBeenCalledWith('invalidate', {
                workspaceId: 'w1',
                resources: ['attendance', 'leaderboard'],
            })
            expect(emit).toHaveBeenCalledWith('invalidate', {
                workspaceId: 'w2',
                resources: ['attendance'],
            })

            // A later write opens a fresh window.
            emitter.invalidateCoalesced('w1', ['attendance'])
            jest.advanceTimersByTime(INVALIDATE_COALESCE_MS)
            expect(emit).toHaveBeenCalledTimes(3)
        })

        it('drops pending emits on shutdown', () => {
            const emit = jest.fn()
            const emitter = new RealtimeEmitter()
            emitter.setServer({ to: () => ({ emit }) } as never)
            emitter.invalidateCoalesced('w1', ['attendance'])
            emitter.onModuleDestroy()
            jest.advanceTimersByTime(INVALIDATE_COALESCE_MS)
            expect(emit).not.toHaveBeenCalled()
        })

        it('no-ops without a server or resources', () => {
            const emitter = new RealtimeEmitter()
            emitter.invalidateCoalesced('w1', ['attendance'])
            const emit = jest.fn()
            emitter.setServer({ to: () => ({ emit }) } as never)
            emitter.invalidateCoalesced('w1', [])
            jest.advanceTimersByTime(INVALIDATE_COALESCE_MS)
            expect(emit).not.toHaveBeenCalled()
        })
    })

    it('invalidates workspace-keyed resources on the given users\' rooms', () => {
        const emit = jest.fn()
        const to = jest.fn().mockReturnValue({ emit })
        const emitter = new RealtimeEmitter()
        emitter.setServer({ to } as never)

        emitter.invalidateUsersInWorkspace(['u1'], 'w1', ['subscription'])
        emitter.invalidateUsersInWorkspace([], 'w1', ['subscription'])

        expect(to).toHaveBeenCalledTimes(1)
        expect(to).toHaveBeenCalledWith([userRoom('u1')])
        expect(emit).toHaveBeenCalledWith('invalidate', {
            workspaceId: 'w1',
            resources: ['subscription'],
        })
    })

    it('moves the users\' sockets into and out of the workspace room', () => {
        const socketsJoin = jest.fn()
        const socketsLeave = jest.fn()
        const inRooms = jest.fn().mockReturnValue({ socketsJoin, socketsLeave })
        const emitter = new RealtimeEmitter()
        emitter.joinWorkspaceRoom(['u1'], 'w1') // no server yet: no-op
        emitter.setServer({ in: inRooms } as never)

        emitter.joinWorkspaceRoom(['u1', 'u2'], 'w1')
        emitter.leaveWorkspaceRoom(['u3'], 'w1')
        emitter.leaveWorkspaceRoom([], 'w1')

        expect(inRooms).toHaveBeenCalledTimes(2)
        expect(inRooms).toHaveBeenNthCalledWith(1, [
            userRoom('u1'),
            userRoom('u2'),
        ])
        expect(socketsJoin).toHaveBeenCalledWith(workspaceRoom('w1'))
        expect(inRooms).toHaveBeenNthCalledWith(2, [userRoom('u3')])
        expect(socketsLeave).toHaveBeenCalledWith(workspaceRoom('w1'))
    })
})
