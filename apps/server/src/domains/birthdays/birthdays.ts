import type { PrismaService } from '../../infrastructure/prisma'
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'

// Birthdays of club members (docs/design/2026-11-26-door-checkin-and-birthdays.md §3.3):
// the daily greeting and the staff «Дни рождения сегодня» list share these.

const isLeapYear = (year: number): boolean =>
    (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

// `dob` is stored as UTC midnight of the calendar day, so its UTC month-day is
// the birthday; `ymd` is the club-local date. 29 February is celebrated on
// 28 February in a non-leap year.
export const isBirthdayOn = (dob: Date, ymd: string): boolean => {
    const birthday = dob.toISOString().slice(5, 10)
    const day = ymd.slice(5, 10)
    if (birthday === day) return true
    return (
        birthday === '02-29' &&
        day === '02-28' &&
        !isLeapYear(Number(ymd.slice(0, 4)))
    )
}

// Age reached on the birthday `ymd`.
export const turnsOn = (dob: Date, ymd: string): number =>
    Number(ymd.slice(0, 4)) - dob.getUTCFullYear()

// A date of birth (YYYY-MM-DD) on which a person turns `years` on `ymd` — the
// demo's birthdays «today». A 29 February `ymd` takes the leap year at or
// before, so the person may be a year older.
export const birthdateTurningOn = (ymd: string, years: number): string => {
    let year = Number(ymd.slice(0, 4)) - years
    if (ymd.endsWith('-02-29')) while (!isLeapYear(year)) year -= 1
    return `${String(year).padStart(4, '0')}${ymd.slice(4)}`
}

// Fixed text with no offer in it (an offer would be advertising and need its
// own consent), and no «вас»: a parent reads «Аня: С днём рождения!».
export const birthdayGreeting = (club: {
    name: string
    type: string
}): { topic: string; message: string } => ({
    topic: 'С днём рождения!',
    message: `Клуб «${club.name}» поздравляет с днём рождения! Здоровья, сил и радости от ${vocabularyForWorkspaceType(club.type).session.genPl}.`,
})

export type BirthdayMember = {
    userId: string
    firstname: string | null
    lastname: string | null
    email: string | null
    profilePhotoUrl: string | null
    dateOfBirth: Date
}

// Active students of the club (role `user`, active account) whose birthday is
// `ymd`. Staff are not greeted and not listed. Clubs are a few hundred
// members, so the month-day filter runs here rather than in SQL.
export const loadBirthdayMembers = async (
    prisma: Pick<PrismaService, 'workspaceMember'>,
    p: { workspaceId: string; ymd: string; userIds?: string[] },
): Promise<BirthdayMember[]> => {
    const rows = await prisma.workspaceMember.findMany({
        where: {
            workspaceId: p.workspaceId,
            status: 'ACTIVE',
            role: { name: 'user' },
            ...(p.userIds ? { userId: { in: p.userIds } } : {}),
            user: { status: 'ACTIVE', dateOfBirth: { not: null } },
        },
        select: {
            user: {
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    profilePhotoUrl: true,
                    dateOfBirth: true,
                },
            },
        },
    })
    return rows.flatMap(({ user }) =>
        user.dateOfBirth && isBirthdayOn(user.dateOfBirth, p.ymd)
            ? [
                  {
                      userId: user.id,
                      firstname: user.firstname,
                      lastname: user.lastname,
                      email: user.email,
                      profilePhotoUrl: user.profilePhotoUrl,
                      dateOfBirth: user.dateOfBirth,
                  },
              ]
            : [],
    )
}
