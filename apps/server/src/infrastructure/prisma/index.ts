export * from './generated/client'
export * from './prisma.config'
export * from './prisma.module'
export * from './prisma.service'
export * from './generated/enums'

import { DefaultArgs, ITXClientDenyList } from '@prisma/client/runtime/client'
import { Prisma, PrismaClient } from './generated/client'

// Same deny list as Prisma.TransactionClient (7.10 dropped `$transaction`
// from it), so a tx client and a helper typed with this stay assignable.
export type PrismaTransactionClientType = Omit<
    PrismaClient<Prisma.LogLevel, never, DefaultArgs>,
    ITXClientDenyList
>
