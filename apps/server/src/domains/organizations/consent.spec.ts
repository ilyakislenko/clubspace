import {
    allConsentedPersonIds,
    consentedPersonIds,
    grantOrgConsent,
    hasOrgConsent,
    ORG_SHARING_CONSENT_VERSION,
    orgConsentGrantedAt,
    orgSharingConsentText,
    withdrawOrgConsent,
} from './consent'

const ORG = 'org-1'

const prismaWith = (
    records: Array<{ userId: string; dependentId: string | null }>,
    guardianships: Array<{ guardianId: string; dependentId: string }> = [],
) => ({
    consentRecord: {
        findMany: jest.fn().mockResolvedValue(records),
        findFirst: jest.fn().mockResolvedValue({ acceptedAt: new Date('2026-11-20T10:00:00Z') }),
        create: jest.fn().mockResolvedValue({ id: 'c1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    guardianship: {
        findMany: jest.fn(async ({ where }: { where: { dependentId: { in: string[] } } }) =>
            guardianships.filter((g) => where.dependentId.in.includes(g.dependentId)),
        ),
    },
})

describe('org sharing consent', () => {
    it('counts an own live record, scoped to the org, kind and not withdrawn', async () => {
        const prisma = prismaWith([{ userId: 'adult', dependentId: null }])
        await expect(hasOrgConsent(prisma as never, ORG, 'adult')).resolves.toBe(true)
        expect(prisma.consentRecord.findMany.mock.calls[0][0].where).toEqual({
            organizationId: ORG,
            kind: 'ORGANIZATION_SHARING',
            withdrawnAt: null,
            OR: [
                { userId: { in: ['adult'] }, dependentId: null },
                { dependentId: { in: ['adult'] } },
            ],
        })
        expect(prisma.guardianship.findMany).not.toHaveBeenCalled()
    })

    it("counts a guardian's record for a child only while that guardianship is confirmed", async () => {
        const confirmed = prismaWith(
            [{ userId: 'parent', dependentId: 'kid' }],
            [{ guardianId: 'parent', dependentId: 'kid' }],
        )
        await expect(hasOrgConsent(confirmed as never, ORG, 'kid')).resolves.toBe(true)
        expect(confirmed.guardianship.findMany.mock.calls[0][0].where).toEqual({
            dependentId: { in: ['kid'] },
            consentAt: { not: null },
        })

        // Another adult's record for the child, or no confirmed link: nothing.
        const stranger = prismaWith(
            [{ userId: 'stranger', dependentId: 'kid' }],
            [{ guardianId: 'parent', dependentId: 'kid' }],
        )
        await expect(hasOrgConsent(stranger as never, ORG, 'kid')).resolves.toBe(false)
        const unconfirmed = prismaWith([{ userId: 'parent', dependentId: 'kid' }], [])
        await expect(hasOrgConsent(unconfirmed as never, ORG, 'kid')).resolves.toBe(false)
    })

    it('resolves the whole population of an org', async () => {
        const prisma = prismaWith(
            [
                { userId: 'adult', dependentId: null },
                { userId: 'parent', dependentId: 'kid' },
                { userId: 'parent', dependentId: 'kid2' },
            ],
            [{ guardianId: 'parent', dependentId: 'kid' }],
        )
        const ids = await allConsentedPersonIds(prisma as never, ORG)
        expect([...ids].sort()).toEqual(['adult', 'kid'])
        expect(prisma.consentRecord.findMany.mock.calls[0][0].where).toEqual({
            organizationId: ORG,
            kind: 'ORGANIZATION_SHARING',
            withdrawnAt: null,
        })
        await expect(consentedPersonIds(prisma as never, ORG, [])).resolves.toEqual(new Set())
    })

    it('records an own consent with the current edition and evidence', async () => {
        const prisma = prismaWith([])
        await grantOrgConsent(prisma as never, {
            organizationId: ORG,
            personId: 'adult',
            guardianId: null,
            ip: '10.0.0.1',
            userAgent: 'x'.repeat(600),
        })
        const data = prisma.consentRecord.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            userId: 'adult',
            dependentId: null,
            organizationId: ORG,
            kind: 'ORGANIZATION_SHARING',
            version: ORG_SHARING_CONSENT_VERSION,
            ip: '10.0.0.1',
        })
        expect(data.userAgent).toHaveLength(512)
    })

    it('records a guardian acting for a child as the guardian with dependentId', async () => {
        const prisma = prismaWith([])
        await grantOrgConsent(prisma as never, {
            organizationId: ORG,
            personId: 'kid',
            guardianId: 'parent',
            ip: null,
            userAgent: null,
        })
        expect(prisma.consentRecord.create.mock.calls[0][0].data).toMatchObject({
            userId: 'parent',
            dependentId: 'kid',
            ip: null,
            userAgent: null,
        })
    })

    it('does not record twice', async () => {
        const prisma = prismaWith([{ userId: 'adult', dependentId: null }])
        await grantOrgConsent(prisma as never, {
            organizationId: ORG,
            personId: 'adult',
            guardianId: null,
            ip: null,
            userAgent: null,
        })
        expect(prisma.consentRecord.create).not.toHaveBeenCalled()
    })

    it('withdraws every live record for the person, own and guardian ones', async () => {
        const prisma = prismaWith([])
        const now = new Date('2026-11-26T12:00:00Z')
        await expect(
            withdrawOrgConsent(prisma as never, { organizationId: ORG, personId: 'kid', now }),
        ).resolves.toBe(2)
        expect(prisma.consentRecord.updateMany.mock.calls[0][0]).toEqual({
            where: {
                organizationId: ORG,
                kind: 'ORGANIZATION_SHARING',
                withdrawnAt: null,
                OR: [
                    { userId: { in: ['kid'] }, dependentId: null },
                    { dependentId: { in: ['kid'] } },
                ],
            },
            data: { withdrawnAt: now },
        })
    })

    it('reports when the consent was given, null without one', async () => {
        const yes = prismaWith([{ userId: 'adult', dependentId: null }])
        await expect(orgConsentGrantedAt(yes as never, ORG, 'adult')).resolves.toEqual(
            new Date('2026-11-20T10:00:00Z'),
        )
        const no = prismaWith([])
        await expect(orgConsentGrantedAt(no as never, ORG, 'adult')).resolves.toBeNull()
    })

    it('names the org and what is shared in the text', () => {
        const text = orgSharingConsentText('Федерация БЖЖ')
        expect(text).toContain('«Федерация БЖЖ»')
        expect(text).toMatch(/пояс/)
        expect(text).toMatch(/отозвать/)
    })

    it('names the child, not the signer, in the guardian wording', () => {
        const text = orgSharingConsentText('Федерация БЖЖ', true)
        expect(text).toContain('имя и фамилию моего ребёнка, его пояс')
        expect(text).toContain('его записи на события')
        expect(text).not.toMatch(/моё имя|мои записи/)
        expect(text).toMatch(/отозвать/)
    })
})
