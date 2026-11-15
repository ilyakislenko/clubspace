// «Разовая скидка 1 000 ₽ · Петров»: who set a sale's amount (pricedById), as
// staff reads show it (docs/design/2026-11-15-discounts.md §4). The column has
// no FK; a person whose user row is gone reads «Бывший сотрудник».
import { displayName } from '../../features/attendance/schemas'
import type { PrismaService, PrismaTransactionClientType } from '../../infrastructure/prisma'

export const FORMER_STAFF_NAME = 'Бывший сотрудник'

export type PricedByNames = ReadonlyMap<string, string>

export const loadPricedByNames = async (
    db: Pick<PrismaService | PrismaTransactionClientType, 'user'>,
    rows: ReadonlyArray<{ pricedById: string | null }>,
): Promise<PricedByNames> => {
    const ids = [...new Set(rows.flatMap((r) => (r.pricedById ? [r.pricedById] : [])))]
    if (ids.length === 0) return new Map()
    const users = await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstname: true, lastname: true, email: true },
    })
    return new Map(users.map((u): [string, string] => [u.id, displayName(u)]))
}

export const pricedByRef = (
    pricedById: string | null,
    names: PricedByNames | undefined,
): { userId: string; name: string } | null =>
    pricedById && names
        ? { userId: pricedById, name: names.get(pricedById) ?? FORMER_STAFF_NAME }
        : null
