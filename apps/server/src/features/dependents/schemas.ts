import { z } from 'zod'

import { Prisma } from '../../infrastructure/prisma'

export const GuardianRelationSchema = z.enum(['PARENT', 'GUARDIAN', 'OTHER'])

// A dependent as its guardian sees it (the profile switcher, «Дети»).
export const MyDependentOutputSchema = z.object({
    id: z.string().uuid(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    dateOfBirth: z.iso.date().nullable(),
    relation: GuardianRelationSchema,
    // PENDING: a club added the child and named this guardian; nothing can be
    // done for the child until the guardian confirms (and consents).
    status: z.enum(['ACTIVE', 'PENDING']),
    consentAt: z.iso.datetime().nullable(),
    consentVersion: z.string().nullable(),
    invitedBy: z
        .object({ workspaceId: z.string().uuid(), name: z.string() })
        .nullable(),
    clubs: z.array(
        z.object({ workspaceId: z.string().uuid(), name: z.string() }),
    ),
})
export type MyDependentOutput = z.infer<typeof MyDependentOutputSchema>

export const myDependentSelect = {
    relation: true,
    consentAt: true,
    consentVersion: true,
    invitedByWorkspace: { select: { id: true, name: true } },
    dependent: {
        select: {
            id: true,
            firstname: true,
            lastname: true,
            dateOfBirth: true,
            workspaceMemberships: {
                where: { status: 'ACTIVE' },
                orderBy: { createdAt: 'asc' },
                select: { workspace: { select: { id: true, name: true } } },
            },
        },
    },
} satisfies Prisma.GuardianshipSelect

export type MyDependentRow = Prisma.GuardianshipGetPayload<{
    select: typeof myDependentSelect
}>

export const serializeMyDependent = (row: MyDependentRow): MyDependentOutput => ({
    id: row.dependent.id,
    firstname: row.dependent.firstname,
    lastname: row.dependent.lastname,
    dateOfBirth: row.dependent.dateOfBirth
        ? row.dependent.dateOfBirth.toISOString().slice(0, 10)
        : null,
    relation: row.relation,
    status: row.consentAt ? 'ACTIVE' : 'PENDING',
    consentAt: row.consentAt ? row.consentAt.toISOString() : null,
    consentVersion: row.consentVersion,
    invitedBy: row.invitedByWorkspace
        ? {
              workspaceId: row.invitedByWorkspace.id,
              name: row.invitedByWorkspace.name,
          }
        : null,
    clubs: row.dependent.workspaceMemberships.map((m) => ({
        workspaceId: m.workspace.id,
        name: m.workspace.name,
    })),
})

// A dependent's guardians on staff member views: the contact a coach reaches
// for a child, shown wherever the member's own contacts are shown.
export const MemberGuardianSchema = z.object({
    userId: z.string().uuid(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    relation: GuardianRelationSchema,
    // false while the guardian has not confirmed the club's invitation.
    confirmed: z.boolean(),
})
export type MemberGuardianOutput = z.infer<typeof MemberGuardianSchema>

// Nested under a `user` select: `user: { select: { ..., dependentOf: memberGuardiansSelect } }`.
export const memberGuardiansSelect = {
    where: { guardian: { status: 'ACTIVE' } },
    orderBy: { createdAt: 'asc' },
    select: {
        relation: true,
        consentAt: true,
        guardian: {
            select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
                phone: true,
            },
        },
    },
} satisfies Prisma.User$dependentOfArgs

export const serializeMemberGuardians = (
    rows: Prisma.GuardianshipGetPayload<{
        select: (typeof memberGuardiansSelect)['select']
    }>[],
): MemberGuardianOutput[] =>
    rows.map((r) => ({
        userId: r.guardian.id,
        firstname: r.guardian.firstname,
        lastname: r.guardian.lastname,
        email: r.guardian.email,
        phone: r.guardian.phone,
        relation: r.relation,
        confirmed: r.consentAt !== null,
    }))
