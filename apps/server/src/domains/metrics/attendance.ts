// Attendance figures over students (glossary B2). A check-in is an
// AttendanceRecord in the club; «был на занятии» = at least one in the window.
// `students_attended_30d` + `students_not_attended_30d` = `students_total`.
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { DAY_MS } from '../subscriptions/freeze-dates'
import { type StudentScope, studentsIn, studentWhere } from './students'

export const ATTENDANCE_WINDOW_DAYS = 30

const checkedInSince = (workspaceId: string, since: Date) => ({
    attendanceRecords: { some: { workspaceId, markedAt: { gte: since } } },
})

// metric `students_attended_7d` / `students_attended_30d`: students with at
// least one check-in since `since`.
export const countStudentsAttended = (
    prisma: PrismaService,
    scope: StudentScope,
    since: Date,
): Promise<number> =>
    prisma.workspaceMember.count({
        where: { AND: [studentsIn(scope), { user: checkedInSince(scope.workspaceId, since) }] },
    })

// metric `students_not_attended_30d` («Не были на занятиях 30 дней»; the
// members filter `inactive`): students without a check-in in the last 30 days,
// never-attended ones included.
export const notAttendedWhere = (
    workspaceId: string,
    ownerId: string,
    now: Date,
): Prisma.WorkspaceMemberWhereInput => ({
    AND: [
        studentWhere(workspaceId, ownerId),
        {
            user: {
                attendanceRecords: {
                    none: {
                        workspaceId,
                        markedAt: { gte: new Date(now.getTime() - ATTENDANCE_WINDOW_DAYS * DAY_MS) },
                    },
                },
            },
        },
    ],
})

export const countStudentsNotAttended = (
    prisma: PrismaService,
    scope: StudentScope,
    now: Date,
): Promise<number> =>
    prisma.workspaceMember.count({
        where: {
            AND: [
                notAttendedWhere(scope.workspaceId, scope.ownerId, now),
                ...(scope.where ? [scope.where] : []),
            ],
        },
    })

// metric `checkins_7d` / `checkins_30d` / `checkins_today` (and the weekly
// trend): check-ins of students since `since` (a coach marking themselves
// present is not one).
export const studentCheckinsWhere = (
    scope: StudentScope,
    since: Date,
): Prisma.AttendanceRecordWhereInput => ({
    workspaceId: scope.workspaceId,
    markedAt: { gte: since },
    user: { workspaceMemberships: { some: studentsIn(scope) } },
})

export const countStudentCheckins = (
    prisma: PrismaService,
    scope: StudentScope,
    since: Date,
): Promise<number> => prisma.attendanceRecord.count({ where: studentCheckinsWhere(scope, since) })
