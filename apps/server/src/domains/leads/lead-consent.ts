import type { PrismaService } from '../../infrastructure/prisma'

// The consent a person gives on the trial-request form (the autopay pattern,
// docs/legal/README.md). The client renders the edition named here
// (apps/client features/legal/lead-consent/registry.ts, pinned by
// specs/legal-lead-consent.spec.ts); a form showing another edition is
// refused so nobody consents to a text the club no longer uses.
export const LEAD_CONSENT_VERSION = '2026-12-01'

export const LEAD_CONSENT_OUTDATED =
    'Текст согласия обновился — обновите страницу'

// The DPA edition that lists «лица, оставившие заявку на пробное занятие» as
// subjects. The public form can't be switched on before the club's latest
// acceptance covers it (docs/design/2026-11-26-leads.md §3.3, §8).
export const LEADS_DPA_MIN_VERSION = '2026-12-01'

// Editions are named by their effective date (optionally with a suffix), so
// a later edition sorts after an earlier one as text.
export const dpaCoversLeads = (dpaVersion: string | null | undefined): boolean =>
    typeof dpaVersion === 'string' &&
    /^\d{4}-\d{2}-\d{2}/.test(dpaVersion) &&
    dpaVersion >= LEADS_DPA_MIN_VERSION

// Whether the club's latest acceptance (the club's standing,
// domains/billing/club-legal.ts) covers lead subjects.
export const loadLeadsDpaAccepted = async (
    prisma: Pick<PrismaService, 'clubLegalAcceptance'>,
    workspaceId: string,
): Promise<boolean> => {
    const latest = await prisma.clubLegalAcceptance.findFirst({
        where: { workspaceId },
        orderBy: { acceptedAt: 'desc' },
        select: { dpaVersion: true },
    })
    return dpaCoversLeads(latest?.dpaVersion)
}
