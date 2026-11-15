import type { z } from 'zod'

import type { RenewalDue } from '../../domains/subscriptions/renewal-rules'
import { type AutopayStatus, autopayForScope } from '../member-autopay/autopay-status'
import { serializeMemberGuardians } from '../dependents/schemas'
import type { RenewalCandidateSchema } from './list-renewal-candidates.feature'

// One «Продлить» row (the list and the AI tool). `autopays`: the member's
// live agreements (loadAutopayStatuses); the one renewing this abonement's
// scope shows on the row.
export const serializeRenewalCandidate = (
    r: RenewalDue,
    autopays: readonly AutopayStatus[] | undefined,
): z.infer<typeof RenewalCandidateSchema> => {
    const { need } = r
    const sub = need.subscription
    const autopay = sub
        ? autopayForScope(autopays, sub.directions.map((d) => d.direction.id))
        : null
    return {
        userId: r.userId,
        firstname: r.user.firstname,
        lastname: r.user.lastname,
        email: r.user.email,
        phone: r.user.phone,
        guardians: serializeMemberGuardians(r.user.dependentOf),
        reason: need.reason,
        classesRemaining: need.current ? (sub?.classesRemaining ?? null) : null,
        classesTotal: need.current ? (sub?.classesTotal ?? null) : null,
        accessUntil: r.accessUntil?.toISOString() ?? null,
        planId: sub?.plan.id ?? null,
        planName: sub?.plan.name ?? null,
        endDate: sub?.endDate?.toISOString() ?? null,
        directions: sub ? sub.directions.map((d) => d.direction) : [],
        autopay: autopay ? { status: autopay.status, nextChargeOn: autopay.nextChargeOn } : null,
    }
}
