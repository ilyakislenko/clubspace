export * from './generated/client'
export * from './prisma.config'
export * from './prisma.module'
export * from './prisma.service'
export * from './generated/enums'

import { DefaultArgs } from '@prisma/client/runtime/client'
import { Prisma, PrismaClient } from './generated/client'

export type PrismaTransactionClientType = Omit<
    PrismaClient<Prisma.LogLevel, never, DefaultArgs>,
    '$extends' | '$transaction' | '$disconnect' | '$connect' | '$on' | '$use'
>
