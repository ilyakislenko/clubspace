import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'

import { EmailTemplatesService } from '../domains/email-templates/services/email-templates.service'
import { RolesService } from '../domains/roles/services/roles.service'
import { TfaRequestGroupEnum } from '../domains/tfa/interfaces/tfa.interfaces'
import { TfaService } from '../domains/tfa/services/tfa.service'
import { environment } from '../environments/environment'
import { PrismaService } from '../infrastructure/prisma/prisma.service'
import { RoleFeaturesEnum, RolesEnum } from '../shared/interfaces/shared.intefaces'

// First-boot seeding (roles, TFA groups, email templates, super admin, default
// workspace), extracted out of AppModule so the module file is pure DI wiring.
@Injectable()
export class BootstrapSeedService implements OnApplicationBootstrap {
    private readonly logger = new Logger(BootstrapSeedService.name)

    constructor(
        private readonly tfaService: TfaService,
        private readonly rolesService: RolesService,
        private readonly emailTemplatesService: EmailTemplatesService,
        private readonly prisma: PrismaService,
    ) {}

    async onApplicationBootstrap() {
        // Platform-level seeding — always. These are the things the product
        // cannot function without, and all of them are idempotent.
        await this.setupTfa()
        await this.setupRoles()
        await this.setupEmailTemplates()
        await this.setupPlatformOwner()

        // Sample club — only when explicitly asked for. Clubs are created from
        // the platform console (POST /platform/workspaces); a deploy inventing
        // one is a leftover from when code was the only way to make a club.
        if (environment.seedDemoWorkspace) {
            await this.setupDemoWorkspace()
        }
    }

    async setupRoles() {
        await this.rolesService.updateFeatures({
            features: [
                {
                    key: RoleFeaturesEnum.GET_MY_DATA,
                    description: 'Get my data',
                },
                {
                    key: RoleFeaturesEnum.MANAGE_USERS,
                    description: 'Manage users',
                },
                {
                    key: RoleFeaturesEnum.MANAGE_PARTNERS,
                    description: 'Manage partners',
                },
                {
                    key: RoleFeaturesEnum.MANAGE_PLANS,
                    description: 'Manage plans',
                },
                {
                    key: RoleFeaturesEnum.MANAGE_SUPPORT,
                    description: 'Manage support',
                },
            ],
        })

        await this.rolesService.createDefaultRole({
            roles: [
                {
                    name: RolesEnum.USER,
                    editable: false,
                    superuser: false,
                    enabledFeatures: [RoleFeaturesEnum.GET_MY_DATA],
                },
                {
                    name: RolesEnum.GLOBAL_ADMIN,
                    editable: false,
                    superuser: true,
                    enabledFeatures: [
                        RoleFeaturesEnum.GET_MY_DATA,
                        RoleFeaturesEnum.MANAGE_USERS,
                        RoleFeaturesEnum.MANAGE_PARTNERS,
                        RoleFeaturesEnum.MANAGE_SUPPORT,
                        RoleFeaturesEnum.MANAGE_PLANS,
                        RoleFeaturesEnum.MANAGE_POSTS,
                    ],
                },
                {
                    name: RolesEnum.ADMIN,
                    editable: false,
                    superuser: false,
                    enabledFeatures: [
                        RoleFeaturesEnum.GET_MY_DATA,
                        RoleFeaturesEnum.MANAGE_USERS,
                        RoleFeaturesEnum.MANAGE_PARTNERS,
                        RoleFeaturesEnum.MANAGE_SUPPORT,
                        RoleFeaturesEnum.MANAGE_POSTS,
                    ],
                },
                {
                    name: RolesEnum.HEAD_COACH,
                    editable: false,
                    superuser: false,
                    enabledFeatures: [
                        RoleFeaturesEnum.GET_MY_DATA,
                        RoleFeaturesEnum.MANAGE_USERS,
                        RoleFeaturesEnum.MANAGE_POSTS,
                    ],
                },
                {
                    name: RolesEnum.COACH,
                    editable: false,
                    superuser: false,
                    enabledFeatures: [
                        RoleFeaturesEnum.GET_MY_DATA,
                        RoleFeaturesEnum.MANAGE_POSTS,
                    ],
                },
            ],
        })

        await this.retireModeratorRole()
    }

    // `moderator` was a template leftover with no product meaning, but it was
    // grantable from the club UI, so real members may hold it. Remap them to
    // `coach` (keeps staff access to the admin app, drops admin scope), then
    // drop the Role row. Idempotent: a no-op once the row is gone.
    private async retireModeratorRole() {
        const moderator = await this.prisma.role.findUnique({
            where: { name: 'moderator' },
            select: { id: true },
        })
        if (!moderator) return

        const coach = await this.prisma.role.findUnique({
            where: { name: 'coach' },
            select: { id: true },
        })
        if (!coach) return

        const { count } = await this.prisma.workspaceMember.updateMany({
            where: { roleId: moderator.id },
            data: { roleId: coach.id },
        })
        if (count > 0) {
            this.logger.log(
                `Remapped ${count} moderator member(s) to coach (role retired)`,
            )
        }

        // WorkspaceMember is the only table referencing Role (permissions
        // cascade), and it was just emptied of this role.
        await this.prisma.role.deleteMany({ where: { id: moderator.id } })
    }

    async setupEmailTemplates() {
        await this.emailTemplatesService.createTemplate({
            key: 'code',
            content: `
                <html>
                    <body style="font-family: Arial, sans-serif; background-color: #f7f6f9; padding: 30px;">
                        <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
                            <h2 style="color:#18171b; font-size: 22px; margin: 0 0 12px 0;">Код для входа</h2>
                            <p style="font-size: 15px; color: #3a3940; margin: 0 0 16px 0;">
                                Введите этот код в приложении, чтобы войти.
                            </p>
                            <div style="margin: 24px 0; text-align: center;">
                                <span style="display: inline-block; font-size: 2em; font-weight: bold; letter-spacing: 8px; background: #efedf2; color: #5b58d9; padding: 18px 38px; border-radius: 8px;">
                                    {{code}}
                                </span>
                            </div>
                            <p style="font-size: 14px; color: #605e68; margin: 0 0 12px 0;">
                                Код действует 15 минут.
                            </p>
                            <p style="font-size: 14px; color: #605e68; margin: 0;">
                                Если вы не запрашивали код, просто проигнорируйте это письмо.
                            </p>
                        </div>
                    </body>
                </html>
            `,
        })

        await this.emailTemplatesService.createTemplate({
            key: 'pending-member',
            content: `
                <html>
                    <body style="font-family: Arial, sans-serif; background-color: #f7f6f9; padding: 30px;">
                        <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
                            <h2 style="color:#18171b; font-size: 22px; margin: 0 0 12px 0;">Новая заявка в академию</h2>
                            <p style="font-size: 15px; color: #3a3940; margin: 0 0 16px 0;">
                                В мобильном приложении <strong>{{workspaceName}}</strong> зарегистрировался новый ученик и ждёт вашего одобрения.
                            </p>
                            <div style="margin: 20px 0; padding: 16px 20px; background: #efedf2; border-radius: 8px;">
                                <div style="font-size: 11px; color: #605e68; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Email ученика</div>
                                <div style="font-size: 16px; font-weight: 600; color: #18171b;">{{userEmail}}</div>
                            </div>
                            <p style="font-size: 14px; color: #605e68; margin: 0 0 20px 0;">
                                Откройте «Участники клуба» в админке и нажмите «Принять» рядом с этим email, чтобы открыть ему доступ к курсам.
                            </p>
                            <a href="{{adminUrl}}" style="display: inline-block; padding: 12px 24px; background: #5b58d9; color: #fff; text-decoration: none; border-radius: 999px; font-size: 14px; font-weight: 700;">Открыть админку</a>
                        </div>
                    </body>
                </html>
            `,
        })

        await this.emailTemplatesService.createTemplate({
            key: 'member-approved',
            content: `
                <html>
                    <body style="font-family: Arial, sans-serif; background-color: #f7f6f9; padding: 30px;">
                        <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
                            <h2 style="color:#18171b; font-size: 22px; margin: 0 0 12px 0;">Вас приняли в клуб</h2>
                            <p style="font-size: 15px; color: #3a3940; margin: 0 0 20px 0;">
                                Клуб «{{workspaceName}}» подтвердил вашу заявку. Откройте приложение клуба — он уже на месте.
                            </p>
                            <div>{{appLinksHtml}}</div>
                        </div>
                    </body>
                </html>
            `,
        })

        await this.emailTemplatesService.createTemplate({
            key: 'member-invite',
            content: `
                <html>
                    <body style="font-family: Arial, sans-serif; background-color: #f7f6f9; padding: 30px;">
                        <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
                            <h2 style="color:#18171b; font-size: 22px; margin: 0 0 12px 0;">Приглашение в клуб</h2>
                            <p style="font-size: 15px; color: #3a3940; margin: 0 0 16px 0;">
                                Клуб «{{workspaceName}}» приглашает вас как {{roleLabel}}.
                            </p>
                            <p style="font-size: 15px; color: #3a3940; margin: 0 0 20px 0;">
                                Установите приложение ClubSpace и войдите с адресом <strong>{{email}}</strong> — код для входа придёт на почту, а клуб уже будет в приложении.
                            </p>
                            <div>{{appLinksHtml}}</div>
                            <p style="font-size: 14px; color: #605e68; margin: 20px 0 0 0;">
                                Вошли с другим адресом? Введите код клуба <strong>{{joinCodeDisplay}}</strong> или откройте ссылку {{joinUrl}}.
                            </p>
                        </div>
                    </body>
                </html>
            `,
        })

        await this.emailTemplatesService.createTemplate({
            key: 'workspace-owner-welcome',
            content: `
                <html>
                    <body style="font-family: Arial, sans-serif; background-color: #f7f6f9; padding: 30px;">
                        <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
                            <h2 style="color:#18171b; font-size: 22px; margin: 0 0 12px 0;">Ваш клуб готов</h2>
                            <p style="font-size: 15px; color: #3a3940; margin: 0 0 20px 0;">
                                Вам передали клуб «{{workspaceName}}» в ClubSpace.
                            </p>
                            <a href="{{signInUrl}}" style="display: inline-block; padding: 12px 24px; background: #5b58d9; color: #fff; text-decoration: none; border-radius: 999px; font-size: 14px; font-weight: 700;">Войти в админку</a>
                            <p style="font-size: 14px; color: #605e68; margin: 12px 0 20px 0;">
                                Вход по коду на почту {{ownerEmail}} — пароль не нужен.
                            </p>
                            <p style="font-size: 14px; color: #605e68; margin: 0 0 12px 0;">
                                Код клуба для учеников: <strong>{{joinCodeDisplay}}</strong> · {{joinUrl}}
                            </p>
                            <div>{{appLinksHtml}}</div>
                        </div>
                    </body>
                </html>
            `,
        })
    }

    async setupTfa() {
        await this.tfaService.updateTfaRequestGroups({
            groups: [
                {
                    key: TfaRequestGroupEnum.AUTH,
                    description: 'Authentication',
                    alwaysEnabled: false,
                },
            ],
        })
    }

    // Ensures the account named by SUPER_ADMIN_EMAIL exists and is a platform
    // administrator. Declarative and idempotent: point the variable at a
    // different address and the next restart promotes it — no DB surgery, no
    // code change. Existing platform admins are never demoted, so the platform
    // can have several.
    //
    // No password is set, and that is not an oversight. Sign-in compares the
    // emailed OTP against User.completeCode; nothing in the server ever reads
    // User.password (there is exactly one bcrypt compare in the codebase and it
    // is against the code). Seeding a hash here produced a credential that
    // authenticated nothing while implying the account was password-protected.
    async setupPlatformOwner() {
        const email = environment.adminEmail

        const existing = await this.prisma.user.findUnique({
            where: { email },
            select: { id: true, isSuperAdmin: true },
        })

        if (!existing) {
            await this.prisma.user.create({
                data: {
                    email,
                    isSuperAdmin: true,
                    firstname: 'System',
                    lastname: 'Administrator',
                    status: 'ACTIVE',
                    language: 'EN',
                },
            })
            this.logger.log(`Platform owner created: ${email}`)
            this.logger.log(
                'Sign in at the admin with this address — the code arrives by email.',
            )
            return
        }

        if (!existing.isSuperAdmin) {
            await this.prisma.user.update({
                where: { id: existing.id },
                data: { isSuperAdmin: true },
            })
            this.logger.log(`Platform owner promoted: ${email}`)
            return
        }

        this.logger.log(`Platform owner present: ${email}`)
    }

    // Sample club for local development, behind SEED_DEMO_WORKSPACE. The
    // content below is grappling-specific (belt levels, guard positions) —
    // fine as a dev fixture, wrong as something a fresh deploy conjures up,
    // which is why it is opt-in rather than the default.
    async setupDemoWorkspace() {
        const WORKSPACE_KEY = environment.defaultWorkspaceKey
        const WORKSPACE_NAME = environment.defaultWorkspaceName
        const WORKSPACE_ADMIN_EMAIL = environment.defaultWorkspaceAdminEmail

        const existingWorkspace = await this.prisma.workspace.findUnique({
            where: { key: WORKSPACE_KEY },
        })

        if (existingWorkspace) {
            this.logger.log(
                `Demo workspace already exists: ${existingWorkspace.name}`,
            )
            return
        }

        const adminRole = await this.prisma.role.findUnique({
            where: { name: 'admin' },
        })

        if (!adminRole) {
            this.logger.warn('Admin role not found, skipping workspace creation')
            return
        }

        const result = await this.prisma.$transaction(async (tx) => {
            // No password, same reason as the platform owner: sign-in is
            // email-OTP and User.password is never read.
            const workspaceAdmin = await tx.user.create({
                data: {
                    email: WORKSPACE_ADMIN_EMAIL,
                    isSuperAdmin: false,
                    firstname: 'Workspace',
                    lastname: 'Admin',
                    status: 'ACTIVE',
                    language: 'EN',
                },
            })

            const workspace = await tx.workspace.create({
                data: {
                    key: WORKSPACE_KEY,
                    name: WORKSPACE_NAME,
                    type: 'GRAPPLING',
                    ownerId: workspaceAdmin.id,
                    isActive: true,
                },
            })

            await tx.workspaceMember.create({
                data: {
                    userId: workspaceAdmin.id,
                    workspaceId: workspace.id,
                    roleId: adminRole.id,
                    status: 'ACTIVE',
                },
            })

            await tx.category.createMany({
                data: [
                    {
                        workspaceId: workspace.id,
                        name: 'Fundamentals',
                        slug: 'fundamentals',
                        order: 1,
                        parentId: null,
                    },
                    {
                        workspaceId: workspace.id,
                        name: 'Positions',
                        slug: 'positions',
                        order: 2,
                        parentId: null,
                    },
                    {
                        workspaceId: workspace.id,
                        name: 'Submissions',
                        slug: 'submissions',
                        order: 3,
                        parentId: null,
                    },
                    {
                        workspaceId: workspace.id,
                        name: 'Escapes',
                        slug: 'escapes',
                        order: 4,
                        parentId: null,
                    },
                    {
                        workspaceId: workspace.id,
                        name: 'Takedowns',
                        slug: 'takedowns',
                        order: 5,
                        parentId: null,
                    },
                    {
                        workspaceId: workspace.id,
                        name: 'Guard Passing',
                        slug: 'guard-passing',
                        order: 6,
                        parentId: null,
                    },
                    {
                        workspaceId: workspace.id,
                        name: 'Drills',
                        slug: 'drills',
                        order: 7,
                        parentId: null,
                    },
                ],
            })

            await tx.tagEntity.createMany({
                data: [
                    { workspaceId: workspace.id, type: 'position', name: 'Closed Guard', slug: 'closed-guard' },
                    { workspaceId: workspace.id, type: 'position', name: 'Open Guard', slug: 'open-guard' },
                    { workspaceId: workspace.id, type: 'position', name: 'Half Guard', slug: 'half-guard' },
                    { workspaceId: workspace.id, type: 'position', name: 'Mount', slug: 'mount' },
                    { workspaceId: workspace.id, type: 'position', name: 'Side Control', slug: 'side-control' },
                    { workspaceId: workspace.id, type: 'position', name: 'Back Control', slug: 'back-control' },
                    { workspaceId: workspace.id, type: 'position', name: 'Turtle', slug: 'turtle' },
                    { workspaceId: workspace.id, type: 'position', name: 'Standing', slug: 'standing' },

                    { workspaceId: workspace.id, type: 'technique', name: 'Armbar', slug: 'armbar' },
                    { workspaceId: workspace.id, type: 'technique', name: 'Triangle', slug: 'triangle' },
                    { workspaceId: workspace.id, type: 'technique', name: 'Rear Naked Choke', slug: 'rnc' },
                    { workspaceId: workspace.id, type: 'technique', name: 'Kimura', slug: 'kimura' },
                    { workspaceId: workspace.id, type: 'technique', name: 'Americana', slug: 'americana' },
                    { workspaceId: workspace.id, type: 'technique', name: 'Guillotine', slug: 'guillotine' },
                    { workspaceId: workspace.id, type: 'technique', name: 'Sweep', slug: 'sweep' },
                    { workspaceId: workspace.id, type: 'technique', name: 'Pass', slug: 'pass' },
                    { workspaceId: workspace.id, type: 'technique', name: 'Escape', slug: 'escape' },

                    { workspaceId: workspace.id, type: 'gi-type', name: 'Gi', slug: 'gi' },
                    { workspaceId: workspace.id, type: 'gi-type', name: 'No-Gi', slug: 'no-gi' },
                    { workspaceId: workspace.id, type: 'gi-type', name: 'Both', slug: 'both' },

                    { workspaceId: workspace.id, type: 'level', name: 'White Belt', slug: 'white' },
                    { workspaceId: workspace.id, type: 'level', name: 'Blue Belt', slug: 'blue' },
                    { workspaceId: workspace.id, type: 'level', name: 'Purple Belt', slug: 'purple' },
                    { workspaceId: workspace.id, type: 'level', name: 'Brown Belt', slug: 'brown' },
                    { workspaceId: workspace.id, type: 'level', name: 'Black Belt', slug: 'black' },
                ],
            })

            await tx.plan.createMany({
                data: [
                    {
                        workspaceId: workspace.id,
                        name: 'Monthly Membership',
                        description: 'Access to all techniques and courses',
                        price: 2999,
                        currency: 'USD',
                    },
                    {
                        workspaceId: workspace.id,
                        name: 'Annual Membership',
                        description: 'Save 20% with annual subscription',
                        price: 28799,
                        currency: 'USD',
                    },
                    {
                        workspaceId: workspace.id,
                        name: 'Lifetime Access',
                        description: 'One-time payment for lifetime access',
                        price: 49999,
                        currency: 'USD',
                    },
                ],
            })

            const welcomeCourse = await tx.course.create({
                data: {
                    workspaceId: workspace.id,
                    title: 'BJJ Fundamentals',
                    slug: 'bjj-fundamentals',
                    description: 'Essential techniques every beginner should know',
                    thumbnailUrl: null,
                },
            })

            return {
                workspace,
                workspaceAdmin,
                welcomeCourse,
            }
        })

        this.logger.log(`Demo workspace created: ${result.workspace.key}`)
        this.logger.log(`Owner account: ${result.workspaceAdmin.email}`)
    }

}
