import { z } from 'zod'

import {
    displayStatus,
    isNeedsAction,
    LEAD_DISPLAY_STATUSES,
    LEAD_LOST_REASONS,
    LEAD_SOURCES,
    LEAD_STATUSES,
    type LeadLostReasonValue,
    type LeadSourceValue,
    type LeadStatusValue,
} from '../../domains/leads/lead-rules'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { normalizePhone } from '../../shared/utils/phone'

export const LeadStatusSchema = z.enum(LEAD_STATUSES)
export const LeadSourceSchema = z.enum(LEAD_SOURCES)
export const LeadLostReasonSchema = z.enum(LEAD_LOST_REASONS)

export const LEAD_PHONE_INVALID = 'Проверьте номер телефона'
export const LEAD_CHILD_REQUIRED = 'Укажите имя и возраст ребёнка'
export const LEAD_EMAIL_INVALID = 'Проверьте e-mail'
export const LEAD_ANONYMIZED = 'Данные заявки удалены'
export const LEAD_NOT_FOUND = 'Заявка не найдена'

export const LEAD_LIMITS = {
    name: 120,
    // As typed («+7 (952) 884-94-20»); stored normalised.
    phone: 40,
    email: 254,
    childName: 80,
    childAgeMin: 1,
    childAgeMax: 17,
    comment: 1000,
    staffNote: 2000,
    lostComment: 500,
} as const

const isEmail = (v: string) => z.email().safeParse(v).success

// The fields a person (or staff for them) fills in. Empty e-mail = none.
export const leadContactFields = {
    name: z.string().trim().min(1).max(LEAD_LIMITS.name),
    phone: z.string().trim().min(1).max(LEAD_LIMITS.phone),
    email: z.string().trim().max(LEAD_LIMITS.email).optional(),
    forChild: z.boolean(),
    childName: z.string().trim().max(LEAD_LIMITS.childName).optional(),
    childAge: z
        .number()
        .int()
        .min(LEAD_LIMITS.childAgeMin)
        .max(LEAD_LIMITS.childAgeMax)
        .optional(),
    // Ignored unless it is one of the club's directions.
    directionId: z.string().uuid().optional(),
    comment: z.string().trim().max(LEAD_LIMITS.comment).optional(),
}

// A child request needs the child's name and age; an e-mail must look like
// one. Shared by the public form and manual entry.
export const refineLeadContact = (
    v: { email?: string; forChild: boolean; childName?: string; childAge?: number },
    ctx: z.RefinementCtx,
) => {
    if (v.email && !isEmail(v.email)) {
        ctx.addIssue({ code: 'custom', path: ['email'], message: LEAD_EMAIL_INVALID })
    }
    if (v.forChild && (!v.childName || v.childAge === undefined)) {
        ctx.addIssue({
            code: 'custom',
            path: [v.childName ? 'childAge' : 'childName'],
            message: LEAD_CHILD_REQUIRED,
        })
    }
}

export const normalizeLeadPhone = (raw: string): string => {
    const phone = normalizePhone(raw)
    if (!phone) throw new BadRequestError({ message: LEAD_PHONE_INVALID })
    return phone
}

export const LeadSchema = z.object({
    id: z.string().uuid(),
    source: LeadSourceSchema,
    // Stored status; `displayStatus` adds the derived BOUGHT.
    status: LeadStatusSchema,
    displayStatus: z.enum(LEAD_DISPLAY_STATUSES),
    // NEW, or a booked trial whose time has passed (the «Сегодня» rule).
    needsAction: z.boolean(),
    // Personal fields are null once anonymised (`anonymizedAt`).
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    forChild: z.boolean(),
    childName: z.string().nullable(),
    childAge: z.number().int().nullable(),
    directionId: z.string().uuid().nullable(),
    directionName: z.string().nullable(),
    comment: z.string().nullable(),
    staffNote: z.string().nullable(),
    trialAt: z.iso.datetime().nullable(),
    trialGroupId: z.string().uuid().nullable(),
    trialGroupName: z.string().nullable(),
    contactedAt: z.iso.datetime().nullable(),
    trialBookedAt: z.iso.datetime().nullable(),
    cameAt: z.iso.datetime().nullable(),
    lostAt: z.iso.datetime().nullable(),
    lostReason: LeadLostReasonSchema.nullable(),
    lostComment: z.string().nullable(),
    convertedUserId: z.string().uuid().nullable(),
    convertedUserName: z.string().nullable(),
    convertedAt: z.iso.datetime().nullable(),
    consentVersion: z.string(),
    consentAt: z.iso.datetime(),
    // Manual entry: the staff member who confirmed verbal consent.
    consentRecordedByName: z.string().nullable(),
    // Set when the same phone asked again and merged into this lead.
    resubmittedAt: z.iso.datetime().nullable(),
    anonymizedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    // The club's zone: trial times are shown in it.
    timezone: z.string(),
    // The zone `trialAt` was booked in and is shown in: the trial group's gym,
    // else the club's. A reschedule prefills and sends wall clock in it.
    trialTimezone: z.string(),
})
export type LeadOutput = z.infer<typeof LeadSchema>

export const leadSelect = {
    id: true,
    source: true,
    status: true,
    name: true,
    phone: true,
    email: true,
    forChild: true,
    childName: true,
    childAge: true,
    directionId: true,
    directionName: true,
    comment: true,
    staffNote: true,
    trialAt: true,
    trialGroupId: true,
    trialGroupName: true,
    trialGroup: { select: { gym: { select: { timezone: true } } } },
    contactedAt: true,
    trialBookedAt: true,
    cameAt: true,
    lostAt: true,
    lostReason: true,
    lostComment: true,
    convertedUserId: true,
    convertedAt: true,
    convertedUser: { select: { firstname: true, lastname: true } },
    consentVersion: true,
    consentAt: true,
    consentRecordedById: true,
    resubmittedAt: true,
    anonymizedAt: true,
    createdAt: true,
    updatedAt: true,
} as const

export type LeadRow = {
    id: string
    source: LeadSourceValue
    status: LeadStatusValue
    name: string | null
    phone: string | null
    email: string | null
    forChild: boolean
    childName: string | null
    childAge: number | null
    directionId: string | null
    directionName: string | null
    comment: string | null
    staffNote: string | null
    trialAt: Date | null
    trialGroupId: string | null
    trialGroupName: string | null
    contactedAt: Date | null
    trialBookedAt: Date | null
    cameAt: Date | null
    lostAt: Date | null
    lostReason: LeadLostReasonValue | null
    lostComment: string | null
    convertedUserId: string | null
    convertedAt: Date | null
    convertedUser: { firstname: string | null; lastname: string | null } | null
    trialGroup: { gym: { timezone: string | null } | null } | null
    consentVersion: string
    consentAt: Date
    consentRecordedById: string | null
    resubmittedAt: Date | null
    anonymizedAt: Date | null
    createdAt: Date
    updatedAt: Date
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export const personName = (
    u: { firstname: string | null; lastname: string | null } | null | undefined,
): string | null =>
    [u?.firstname, u?.lastname]
        .map((p) => p?.trim())
        .filter(Boolean)
        .join(' ') || null

export const serializeLead = (
    row: LeadRow,
    ctx: {
        now: Date
        timezone: string
        bought: boolean
        // consentRecordedById → staff name.
        staffNames: Map<string, string>
    },
): LeadOutput => ({
    id: row.id,
    source: row.source,
    status: row.status,
    displayStatus: displayStatus(row, ctx.bought),
    needsAction: isNeedsAction(row, ctx.now),
    name: row.name,
    phone: row.phone,
    email: row.email,
    forChild: row.forChild,
    childName: row.childName,
    childAge: row.childAge,
    directionId: row.directionId,
    directionName: row.directionName,
    comment: row.comment,
    staffNote: row.staffNote,
    trialAt: iso(row.trialAt),
    trialGroupId: row.trialGroupId,
    trialGroupName: row.trialGroupName,
    contactedAt: iso(row.contactedAt),
    trialBookedAt: iso(row.trialBookedAt),
    cameAt: iso(row.cameAt),
    lostAt: iso(row.lostAt),
    lostReason: row.lostReason,
    lostComment: row.lostComment,
    convertedUserId: row.convertedUserId,
    convertedUserName: personName(row.convertedUser),
    convertedAt: iso(row.convertedAt),
    consentVersion: row.consentVersion,
    consentAt: row.consentAt.toISOString(),
    consentRecordedByName: row.consentRecordedById
        ? (ctx.staffNames.get(row.consentRecordedById) ?? null)
        : null,
    resubmittedAt: iso(row.resubmittedAt),
    anonymizedAt: iso(row.anonymizedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    timezone: ctx.timezone,
    trialTimezone: row.trialGroup?.gym?.timezone ?? ctx.timezone,
})
