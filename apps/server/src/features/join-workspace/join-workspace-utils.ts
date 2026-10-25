import type { JoinOutcome } from '../../domains/workspace/services/join-request.service'

export type JoinStatus = 'active' | 'pending' | 'rejected'

// What the applicant is told: the owner and ACTIVE members are in, INVITED is
// waiting for an admin, BLOCKED and SUSPENDED were turned down.
export const joinStatusOf = (outcome: JoinOutcome): JoinStatus => {
    if (outcome.kind === 'owner') return 'active'
    switch (outcome.status) {
        case 'ACTIVE':
            return 'active'
        case 'INVITED':
            return 'pending'
        default:
            return 'rejected'
    }
}
