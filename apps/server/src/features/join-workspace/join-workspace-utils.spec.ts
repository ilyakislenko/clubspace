import { joinStatusOf } from './join-workspace-utils'

describe('joinStatusOf', () => {
    it('maps the owner and ACTIVE members to active', () => {
        expect(joinStatusOf({ kind: 'owner' })).toBe('active')
        expect(
            joinStatusOf({ kind: 'existing', status: 'ACTIVE', membershipId: 'm' }),
        ).toBe('active')
        expect(
            joinStatusOf({ kind: 'created', status: 'ACTIVE', membershipId: 'm' }),
        ).toBe('active')
    })

    it('maps INVITED to pending', () => {
        expect(
            joinStatusOf({ kind: 'existing', status: 'INVITED', membershipId: 'm' }),
        ).toBe('pending')
        expect(
            joinStatusOf({ kind: 'created', status: 'INVITED', membershipId: 'm' }),
        ).toBe('pending')
    })

    it('maps BLOCKED and SUSPENDED to rejected', () => {
        expect(
            joinStatusOf({ kind: 'existing', status: 'BLOCKED', membershipId: 'm' }),
        ).toBe('rejected')
        expect(
            joinStatusOf({
                kind: 'existing',
                status: 'SUSPENDED',
                membershipId: 'm',
            }),
        ).toBe('rejected')
    })
})
