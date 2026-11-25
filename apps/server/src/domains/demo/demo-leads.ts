import type { Prisma } from '../../infrastructure/prisma'
import { LEAD_CONSENT_VERSION } from '../leads/lead-consent'
import type { LeadLostReasonValue, LeadSourceValue } from '../leads/lead-rules'

const HOUR_MS = 60 * 60_000

// One «Пробные» row of a demo club (docs/design/2026-11-26-leads.md §9), its
// stamps derived from the stage it reached so the report reads consistently.
// Phones come from the +7 900 2xx block, apart from members' +7 900 1xx.
export type DemoLeadSpec = {
    id: string
    name: string
    phoneN: number
    source: LeadSourceValue
    createdAt: Date
    // How far it got; BOUGHT/CAME with `convertedUserId` are linked.
    stage: 'NEW' | 'CONTACTED' | 'TRIAL_BOOKED' | 'CAME' | 'LOST'
    child?: { name: string; age: number }
    direction?: { id: string; name: string }
    comment?: string
    trial?: { at: Date; groupId: string; groupName: string }
    lost?: LeadLostReasonValue
    convertedUserId?: string
    // Hours from receiving to «Связались».
    contactAfterH?: number
    staffId: string | null
}

export const demoLeadPhone = (n: number) =>
    `+79002${String((n * 7919 + 51_437) % 1_000_000).padStart(6, '0')}`

export const demoLeadRow = (workspaceId: string, s: DemoLeadSpec): Prisma.LeadCreateManyInput => {
    const t = s.createdAt.getTime()
    const contacted = s.stage === 'NEW' ? null : new Date(t + (s.contactAfterH ?? 3) * HOUR_MS)
    const booked = s.trial && s.stage !== 'CONTACTED' ? new Date(t + ((s.contactAfterH ?? 3) + 1) * HOUR_MS) : null
    const came = s.stage === 'CAME' && s.trial ? new Date(s.trial.at.getTime() + 2 * HOUR_MS) : null
    const lostAt = s.stage === 'LOST' ? new Date(t + 3 * 24 * HOUR_MS) : null
    const convertedAt = s.convertedUserId && came ? new Date(came.getTime() + HOUR_MS) : null
    const changed = convertedAt ?? came ?? lostAt ?? booked ?? contacted ?? s.createdAt
    return {
        id: s.id,
        workspaceId,
        source: s.source,
        status: s.stage,
        statusChangedAt: changed,
        name: s.name,
        phone: demoLeadPhone(s.phoneN),
        forChild: Boolean(s.child),
        childName: s.child?.name ?? null,
        childAge: s.child?.age ?? null,
        directionId: s.direction?.id ?? null,
        directionName: s.direction?.name ?? null,
        comment: s.comment ?? null,
        trialAt: s.trial && s.stage !== 'CONTACTED' ? s.trial.at : null,
        trialGroupId: s.trial && s.stage !== 'CONTACTED' ? s.trial.groupId : null,
        trialGroupName: s.trial && s.stage !== 'CONTACTED' ? s.trial.groupName : null,
        contactedAt: contacted,
        trialBookedAt: booked,
        cameAt: came,
        lostAt,
        lostReason: s.lost ?? null,
        convertedUserId: convertedAt ? s.convertedUserId : null,
        convertedAt,
        consentVersion: LEAD_CONSENT_VERSION,
        consentAt: s.createdAt,
        consentIp: s.source === 'MANUAL' ? null : '192.0.2.10',
        consentUserAgent: s.source === 'MANUAL' ? null : 'Mozilla/5.0 (demo)',
        consentRecordedById: s.source === 'MANUAL' ? s.staffId : null,
        createdById: s.source === 'MANUAL' ? s.staffId : null,
        createdAt: s.createdAt,
        updatedAt: changed,
    }
}
