import { ConflictError } from '../../shared/errors/shared.errors'
import type { PayrollDb } from './payroll-loader'
import { monthToDbDate } from './payroll-rules'

export const MONTH_CLOSED_MESSAGE =
    'Месяц закрыт — откройте его заново или внесите корректировку в следующий месяц'

// Serialises the club's payroll writes (rate, adjustment, close, reopen) for
// the rest of the transaction, so a write and a close can never interleave
// between the lock check and the commit.
export const lockPayroll = async (tx: PayrollDb, workspaceId: string): Promise<void> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll:${workspaceId}`}))`
}

// Every payroll write calls this inside its transaction: a closed month
// refuses changes (409).
export const assertMonthOpen = async (
    tx: PayrollDb,
    workspaceId: string,
    month: string,
): Promise<void> => {
    await lockPayroll(tx, workspaceId)
    const closed = await tx.payrollMonth.findUnique({
        where: { workspaceId_month: { workspaceId, month: monthToDbDate(month) } },
        select: { id: true },
    })
    if (closed) throw new ConflictError({ message: MONTH_CLOSED_MESSAGE })
}
