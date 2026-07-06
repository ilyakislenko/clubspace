import {
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
})
