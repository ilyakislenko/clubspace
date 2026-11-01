import { setTimeout as sleep } from 'timers/promises'

import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createPlan, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// «Импорт клуба» end to end: a real CSV through upload → dry run → apply, with
// the background worker and the database. The dry run must write nothing,
// apply must create exactly what the preview listed, and the same file again
// must change nothing.
describe('club import', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
    })

    const base = (workspaceId: string) => `/workspaces/${workspaceId}/club-imports`

    // Club-local calendar days around today, as the file writes them.
    const day = (offset: number) => {
        const d = new Date(Date.now() + offset * 24 * 60 * 60 * 1000)
        const local = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Moscow',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(d)
        const [y, m, dd] = local.split('-')
        return { ru: `${dd}.${m}.${y}`, iso: local }
    }

    const upload = (actor: Actor, workspaceId: string, bytes: Buffer, name = 'club.csv') =>
        ctx
            .http()
            .post(base(workspaceId))
            .set(...actor.auth)
            .attach('file', bytes, name)

    const waitFor = async (
        actor: Actor,
        workspaceId: string,
        importId: string,
        status: 'previewed' | 'applied',
    ) => {
        for (let i = 0; i < 200; i++) {
            const res = await ctx
                .http()
                .get(`${base(workspaceId)}/${importId}`)
                .set(...actor.auth)
                .expect(200)
            if (res.body.status === status) return res.body
            if (res.body.status === 'failed') throw new Error(res.body.error)
            await sleep(100)
        }
        throw new Error(`import ${importId} never reached ${status}`)
    }

    const preview = async (
        actor: Actor,
        workspaceId: string,
        imp: { id: string; mapping: object },
        options: { createMissing?: boolean; overwrite?: boolean } = {},
    ) => {
        await ctx
            .http()
            .post(`${base(workspaceId)}/${imp.id}/preview`)
            .set(...actor.auth)
            .send({ mapping: imp.mapping, createMissing: false, overwrite: false, ...options })
            .expect(201)
        return waitFor(actor, workspaceId, imp.id, 'previewed')
    }

    const apply = async (actor: Actor, workspaceId: string, importId: string) => {
        await ctx
            .http()
            .post(`${base(workspaceId)}/${importId}/apply`)
            .set(...actor.auth)
            .expect(201)
        return waitFor(actor, workspaceId, importId, 'applied')
    }

    const rows = async (actor: Actor, workspaceId: string, importId: string) =>
        (
            await ctx
                .http()
                .get(`${base(workspaceId)}/${importId}/rows`)
                .set(...actor.auth)
                .expect(200)
        ).body.data as Array<{ line: number; action: string; messages: string[]; changes: string[] }>

    const snapshot = async (workspaceId: string) => ({
        users: await ctx.prisma.user.count(),
        members: await ctx.prisma.workspaceMember.count({ where: { workspaceId } }),
        groups: await ctx.prisma.group.count({ where: { workspaceId } }),
        groupMembers: await ctx.prisma.groupMember.count({ where: { group: { workspaceId } } }),
        gyms: await ctx.prisma.gym.count({ where: { workspaceId } }),
        directions: await ctx.prisma.direction.count({ where: { workspaceId } }),
        plans: await ctx.prisma.plan.count({ where: { workspaceId } }),
        subscriptions: await ctx.prisma.subscription.count({ where: { workspaceId } }),
        promotions: await ctx.prisma.rankPromotion.count({ where: { workspaceId } }),
        levels: await ctx.prisma.rankLevel.count({ where: { ladder: { workspaceId } } }),
        guardianships: await ctx.prisma.guardianship.count(),
        invitations: await ctx.prisma.workspaceInvitation.count({ where: { workspaceId } }),
    })

    // A club already on ClubSpace with one gym, the БЖЖ direction, an adult
    // group, a 12-class tariff and a belt ladder.
    const seedClub = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Гладиатор' })
        const gym = await ctx.prisma.gym.create({
            data: { workspaceId: workspace.id, name: 'Центральный', address: 'Ленина, 1' },
        })
        const bjj = await ctx.prisma.direction.create({
            data: { workspaceId: workspace.id, name: 'БЖЖ' },
        })
        const adults = await ctx.prisma.group.create({
            data: {
                workspaceId: workspace.id,
                name: 'Взрослые',
                gymId: gym.id,
                directionId: bjj.id,
                coachId: owner.id,
                coaches: { create: { userId: owner.id, role: 'primary' } },
            },
        })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: '12 занятий',
            classCount: 12,
            durationDays: 30,
        })
        const ladder = await ctx.prisma.rankLadder.create({
            data: {
                workspaceId: workspace.id,
                name: 'Пояса БЖЖ',
                directionId: bjj.id,
                levels: {
                    create: [
                        { name: 'Белый пояс', order: 0, maxStripes: 4 },
                        { name: 'Синий пояс', order: 1, maxStripes: 4 },
                    ],
                },
            },
            include: { levels: true },
        })
        const ownerActor = await signIn(ctx, owner.email as string)
        return { workspace, owner, ownerActor, gym, bjj, adults, plan, ladder }
    }

    const start = day(-5)
    const end = day(25)
    const csv = (lines: string[][]) =>
        Buffer.from(lines.map((l) => l.join(',')).join('\r\n'), 'utf8')

    const clubFile = () =>
        csv([
            ['ФИО', 'E-mail', 'Телефон', 'Дата рождения', 'E-mail родителя', 'Зал', 'Направление', 'Группа', 'Пояс', 'Полоски', 'Абонемент', 'Дата начала', 'Дата окончания', 'Осталось занятий', 'Оплачено', 'Заметки'],
            ['Иванов Иван', 'Ivan@Example.com', '8 900 111-22-33', '15.04.1990', '', 'Центральный', 'БЖЖ', 'Взрослые', 'Синий пояс', '2', '12 занятий', start.ru, end.ru, '7', 'да', 'травма колена'],
            ['Петрова Маша', '', '', '03.09.2016', 'mama@example.com', 'Центральный', 'ММА', 'Дети ММА', '', '', 'Безлимит', start.ru, '', '', 'нет', ''],
            ['Знакомый Пётр', 'known@example.com', '', '', '', 'Центральный', 'БЖЖ', 'Взрослые', '', '', '', '', '', '', '', ''],
            ['Без Почты', '', '', '01.01.1985', '', '', '', '', '', '', '', '', '', '', '', ''],
            ['Иванов Иван', 'ivan@example.com', '', '', '', 'Центральный', 'ММА', 'ММА вечер', '', '', '', '', '', '', '', ''],
        ])

    it('dry run writes nothing; apply creates what was previewed; the same file again is a no-op', async () => {
        const club = await seedClub()
        const { workspace, ownerActor } = club
        const known = await createUser(ctx, { email: 'known@example.com', firstname: 'Пётр' })

        const uploaded = await upload(ownerActor, workspace.id, clubFile()).expect(201)
        expect(uploaded.body).toMatchObject({
            status: 'uploaded',
            encoding: 'utf-8',
            delimiter: ',',
            rowCount: 5,
            mapping: {
                fullName: 0,
                email: 1,
                phone: 2,
                dateOfBirth: 3,
                parentEmail: 4,
                gym: 5,
                direction: 6,
                group: 7,
                rank: 8,
                stripes: 9,
                plan: 10,
                startDate: 11,
                endDate: 12,
                classesLeft: 13,
                paid: 14,
                notes: 15,
            },
        })
        const before = await snapshot(workspace.id)

        // Without «Создать недостающие» the rows that need ММА are skipped.
        const strict = await preview(ownerActor, workspace.id, uploaded.body)
        expect(strict.summary).toMatchObject({ rows: 5, create: 1, invite: 1, skip: 3, error: 0 })
        expect(strict.missing).toEqual({
            gyms: [],
            directions: ['Направление «ММА»'],
            groups: ['Группа «Дети ММА» (Центральный, ММА)', 'Группа «ММА вечер» (Центральный, ММА)'],
            plans: ['Абонемент «Безлимит»'],
            ranks: [],
        })
        const strictRows = await rows(ownerActor, workspace.id, uploaded.body.id)
        expect(strictRows.find((r) => r.line === 3)?.action).toBe('skip')
        expect(strictRows.find((r) => r.line === 3)?.messages[0]).toContain('Создать недостающие')
        expect(strictRows.find((r) => r.line === 5)?.messages[0]).toContain('Нет e-mail')

        const full = await preview(ownerActor, workspace.id, uploaded.body, { createMissing: true })
        expect(full.summary).toMatchObject({
            rows: 5,
            create: 2,
            update: 1,
            invite: 1,
            skip: 1,
            error: 0,
            children: 1,
            groupMemberships: 3,
            subscriptions: 2,
            ranks: 1,
            createdDirections: 1,
            createdGroups: 2,
            createdPlans: 1,
        })
        // Neither preview touched the club.
        expect(await snapshot(workspace.id)).toEqual(before)

        const applied = await apply(ownerActor, workspace.id, uploaded.body.id)
        expect(applied.summary).toEqual({ ...full.summary })

        const ivan = await ctx.prisma.user.findUniqueOrThrow({
            where: { email: 'ivan@example.com' },
            include: { workspaceMemberships: true, groupMemberships: { include: { group: true } } },
        })
        expect(ivan).toMatchObject({ firstname: 'Иван', lastname: 'Иванов', phone: '+79001112233' })
        expect(ivan.dateOfBirth?.toISOString().slice(0, 10)).toBe('1990-04-15')
        const ivanMember = ivan.workspaceMemberships[0]
        expect(ivanMember).toMatchObject({ status: 'ACTIVE', notes: 'травма колена' })
        expect(ivan.groupMemberships.map((g) => g.group.name).sort()).toEqual(['ММА вечер', 'Взрослые'].sort())
        const mmaEvening = ivan.groupMemberships.find((g) => g.group.name === 'ММА вечер')?.group
        const mma = await ctx.prisma.direction.findFirstOrThrow({ where: { workspaceId: workspace.id, name: 'ММА' } })
        expect(mmaEvening).toMatchObject({ gymId: club.gym.id, directionId: mma.id })

        const ivanSub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceMemberId: ivanMember.id },
        })
        expect(ivanSub).toMatchObject({
            planId: club.plan.id,
            status: 'ACTIVE',
            classesTotal: 12,
            classesRemaining: 7,
            isPaid: true,
        })
        // A club-wide tariff: the abonement's direction snapshot is empty.
        expect(await ctx.prisma.subscriptionDirection.count({ where: { subscriptionId: ivanSub.id } })).toBe(0)
        expect(ivanMember.accessUntil?.getTime()).toBe(ivanSub.endDate?.getTime())
        const blue = club.ladder.levels.find((l) => l.name === 'Синий пояс')
        expect(
            await ctx.prisma.rankPromotion.findFirst({ where: { userId: ivan.id, workspaceId: workspace.id } }),
        ).toMatchObject({ ladderId: club.ladder.id, levelId: blue?.id, stripes: 2 })

        // The child: a profile without a login, in the club at once, and a
        // pending link only the parent can confirm.
        const masha = await ctx.prisma.user.findFirstOrThrow({
            where: { firstname: 'Маша', workspaceMemberships: { some: { workspaceId: workspace.id } } },
            include: { dependentOf: { include: { guardian: true } }, groupMemberships: { include: { group: true } } },
        })
        expect(masha.email).toBeNull()
        expect(masha.dependentOf).toHaveLength(1)
        expect(masha.dependentOf[0]).toMatchObject({ consentAt: null, invitedByWorkspaceId: workspace.id })
        expect(masha.dependentOf[0].guardian.email).toBe('mama@example.com')
        expect(masha.groupMemberships.map((g) => g.group.name)).toEqual(['Дети ММА'])
        const mashaSub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceMember: { userId: masha.id } },
            include: { plan: { include: { directions: true } }, directions: true },
        })
        expect(mashaSub).toMatchObject({ isPaid: false, plan: { name: 'Безлимит', price: 0 } })
        // The abonement carries the same direction set as the tariff the import created.
        expect(mashaSub.directions.map((d) => d.directionId)).toEqual(
            mashaSub.plan.directions.map((d) => d.directionId),
        )

        // An existing account gets an invitation, never a membership.
        expect(
            await ctx.prisma.workspaceMember.findFirst({ where: { userId: known.id, workspaceId: workspace.id } }),
        ).toBeNull()
        expect(
            await ctx.prisma.workspaceInvitation.findFirst({ where: { userId: known.id, workspaceId: workspace.id } }),
        ).toMatchObject({ roleName: 'user', groupId: club.adults.id })

        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({
            where: { workspaceId: workspace.id, action: 'club.import' },
        })
        expect(audit.metadata).toMatchObject({ create: 2, update: 1, invite: 1, subscriptions: 2 })

        // The same file again: nothing new, nothing duplicated.
        const after = await snapshot(workspace.id)
        const again = await upload(ownerActor, workspace.id, clubFile()).expect(201)
        const againPreview = await preview(ownerActor, workspace.id, again.body, { createMissing: true })
        expect(againPreview.summary).toMatchObject({ create: 0, update: 0, invite: 0, error: 0, skip: 5 })
        expect(againPreview.missing).toEqual({ gyms: [], directions: [], groups: [], plans: [], ranks: [] })
        await apply(ownerActor, workspace.id, again.body.id)
        expect(await snapshot(workspace.id)).toEqual(after)
    })

    // Excel in a Russian locale saves «CSV (разделители — запятые)» as
    // Windows-1251 with «;» between cells.
    const toCp1251 = (text: string): Buffer =>
        Buffer.from(
            Array.from(text, (ch) => {
                const code = ch.charCodeAt(0)
                if (code < 0x80) return code
                if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0
                if (code === 0x401) return 0xa8
                if (code === 0x451) return 0xb8
                throw new Error(`no cp1251 for ${ch}`)
            }),
        )

    it('reads a Windows-1251 file with «;» and dd.mm.yyyy dates', async () => {
        const { workspace, ownerActor } = await seedClub()
        const file = toCp1251(
            [
                'Фамилия;Имя;Эл. почта;Дата рождения;Группа;Заметки',
                'Сёмин;Алёша;alesha@example.com;07.02.2001;Взрослые;"левша; мечтает о чёрном поясе"',
            ].join('\r\n'),
        )
        const uploaded = await upload(ownerActor, workspace.id, file).expect(201)
        expect(uploaded.body).toMatchObject({
            encoding: 'windows-1251',
            delimiter: ';',
            headers: ['Фамилия', 'Имя', 'Эл. почта', 'Дата рождения', 'Группа', 'Заметки'],
            mapping: { lastname: 0, firstname: 1, email: 2, dateOfBirth: 3, group: 4, notes: 5 },
        })
        const previewed = await preview(ownerActor, workspace.id, uploaded.body)
        expect(previewed.summary).toMatchObject({ create: 1, error: 0, groupMemberships: 1 })
        await apply(ownerActor, workspace.id, uploaded.body.id)

        const alesha = await ctx.prisma.user.findUniqueOrThrow({
            where: { email: 'alesha@example.com' },
            include: { workspaceMemberships: true },
        })
        expect(alesha).toMatchObject({ firstname: 'Алёша', lastname: 'Сёмин' })
        expect(alesha.dateOfBirth?.toISOString().slice(0, 10)).toBe('2001-02-07')
        expect(alesha.workspaceMemberships[0].notes).toBe('левша; мечтает о чёрном поясе')
    })

    it('refuses files over the limits with a clear message', async () => {
        const { workspace, ownerActor } = await seedClub()
        const header = 'ФИО,E-mail'
        const many = [header, ...Array.from({ length: 5001 }, (_, i) => `Ученик ${i},u${i}@example.com`)].join('\n')
        const tooMany = await upload(ownerActor, workspace.id, Buffer.from(many)).expect(400)
        expect(tooMany.body.message).toContain('до 5000')

        const big = Buffer.alloc(2 * 1024 * 1024 + 10, 'a')
        const tooBig = await upload(ownerActor, workspace.id, big).expect(400)
        expect(tooBig.body.message).toContain('МБ')

        const empty = await upload(ownerActor, workspace.id, Buffer.from(header)).expect(400)
        expect(empty.body.message).toContain('нет данных')
    })

    it('only an admin or head coach can import, and only into their own club', async () => {
        const { workspace, ownerActor } = await seedClub()
        const { user: coach } = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.COACH })
        const { user: headCoach } = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.HEAD_COACH })
        const coachActor = await signIn(ctx, coach.email as string)
        const headActor = await signIn(ctx, headCoach.email as string)

        const file = csv([['ФИО', 'E-mail'], ['Новый Ученик', 'new@example.com']])
        await upload(coachActor, workspace.id, file).expect(403)
        await ctx.http().get(`${base(workspace.id)}/template.csv`).set(...coachActor.auth).expect(403)
        const mine = await upload(headActor, workspace.id, file).expect(201)
        await ctx
            .http()
            .get(`${base(workspace.id)}/${mine.body.id}`)
            .set(...coachActor.auth)
            .expect(403)

        const template = await ctx
            .http()
            .get(`${base(workspace.id)}/template.csv`)
            .set(...headActor.auth)
            .expect(200)
        expect(template.text).toContain('ФИО;E-mail;Телефон;Дата рождения;E-mail родителя;Зал')

        // Another club's admin: refused on our club's URL, and our import id
        // is not found under theirs.
        const other = await createWorkspace(ctx, { name: 'Чужой клуб' })
        const otherActor = await signIn(ctx, other.owner.email as string)
        await ctx.http().get(`${base(workspace.id)}/${mine.body.id}`).set(...otherActor.auth).expect(403)
        await upload(otherActor, workspace.id, file).expect(403)
        await ctx.http().get(`${base(other.workspace.id)}/${mine.body.id}`).set(...otherActor.auth).expect(404)
        await ctx.http().get(`${base(other.workspace.id)}/${mine.body.id}/rows`).set(...otherActor.auth).expect(404)
        await ctx
            .http()
            .post(`${base(other.workspace.id)}/${mine.body.id}/preview`)
            .set(...otherActor.auth)
            .send({ mapping: mine.body.mapping })
            .expect(404)
        await ctx
            .http()
            .post(`${base(other.workspace.id)}/${mine.body.id}/apply`)
            .set(...otherActor.auth)
            .expect(404)

        // Apply needs a finished preview first.
        await ctx
            .http()
            .post(`${base(workspace.id)}/${mine.body.id}/apply`)
            .set(...ownerActor.auth)
            .expect(409)
        expect(await ctx.prisma.user.findUnique({ where: { email: 'new@example.com' } })).toBeNull()
    })
})
