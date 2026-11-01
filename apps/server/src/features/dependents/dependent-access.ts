import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { type MyDependentRow, myDependentSelect } from './schemas'

// The caller's own link to a live dependent, pending or confirmed. Anyone
// else's child is "not found": the response never confirms a profile exists.
export const loadMyDependentLink = async (
    prisma: Pick<PrismaService, 'guardianship'>,
    guardianId: string,
    dependentId: string,
): Promise<MyDependentRow & { id: string }> => {
    const link = await prisma.guardianship.findFirst({
        where: {
            guardianId,
            dependentId,
            dependent: { status: 'ACTIVE' },
        },
        select: { id: true, ...myDependentSelect },
    })
    if (!link) {
        throw new NotFoundError({ message: 'Профиль ребёнка не найден' })
    }
    return link
}

// Column widths of ConsentRecord.ip / userAgent.
const IP_MAX = 64
const USER_AGENT_MAX = 512

// The evidence of a guardian's consent to a dependent's data, in the same
// ConsentRecord log as the personal-data consent (who, which edition, when,
// from where). Guardianship.consentAt/consentVersion carry the link's state.
export const recordDependentConsent = async (
    prisma: Pick<PrismaService, 'consentRecord'>,
    p: {
        guardianId: string
        dependentId: string
        version: string
        ip: string | null
        userAgent: string | null
    },
): Promise<void> => {
    await prisma.consentRecord.create({
        data: {
            userId: p.guardianId,
            kind: 'DEPENDENT_DATA',
            dependentId: p.dependentId,
            version: p.version,
            ip: p.ip ? p.ip.slice(0, IP_MAX) : null,
            userAgent: p.userAgent ? p.userAgent.slice(0, USER_AGENT_MAX) : null,
        },
    })
}

// A guardian stepping back from a child withdraws their consent for it; the
// acceptance stays as evidence, minus where it was given from.
export const withdrawDependentConsent = async (
    prisma: Pick<PrismaService, 'consentRecord'>,
    p: { guardianId: string; dependentId: string },
): Promise<void> => {
    await prisma.consentRecord.updateMany({
        where: {
            userId: p.guardianId,
            dependentId: p.dependentId,
            kind: 'DEPENDENT_DATA',
            withdrawnAt: null,
        },
        data: { withdrawnAt: new Date(), ip: null, userAgent: null },
    })
}
