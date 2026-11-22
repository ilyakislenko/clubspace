// metric `students_with_abonement` («Ученики с абонементом»): students holding
// at least one current abonement (currentSubscriptionWhere — paid or not, a
// pack waiting for its first visit included). People, not abonements: a
// student with «БЖЖ» and «Тайский бокс» counts once.
import type { PrismaService } from '../../infrastructure/prisma'
import { currentSubscriptionWhere } from '../subscriptions/current-subscriptions'
import { type StudentScope, studentsIn } from './students'

export const countStudentsWithAbonement = (
    prisma: PrismaService,
    scope: StudentScope,
    now: Date,
): Promise<number> =>
    prisma.workspaceMember.count({
        where: {
            AND: [studentsIn(scope), { subscriptions: { some: currentSubscriptionWhere(now) } }],
        },
    })
