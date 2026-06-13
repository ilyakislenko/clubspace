import { Injectable, OnApplicationBootstrap } from '@nestjs/common'
import * as bcrypt from 'bcrypt'

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
    constructor(
        private readonly tfaService: TfaService,
        private readonly rolesService: RolesService,
        private readonly emailTemplatesService: EmailTemplatesService,
        private readonly prisma: PrismaService,
    ) {}

    async onApplicationBootstrap() {
        await this.setupTfa()
        await this.setupRoles()
        await this.setupEmailTemplates()
        await this.setupSystemUser()
        await this.setupDefaultWorkspace()
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
                    name: RolesEnum.MODERATOR,
                    editable: false,
                    superuser: false,
                    enabledFeatures: [
                        RoleFeaturesEnum.GET_MY_DATA,
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
    }

    async setupEmailTemplates() {
        await this.emailTemplatesService.createTemplate({
            key: 'code',
            content: `
                <html>
                    <body style="font-family: Arial, sans-serif; background-color: #f7f7f7; padding: 30px;">
                        <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 30px;">
                            <h2 style="color:#333; font-size: 24px; margin-bottom: 12px;">Verify your email address</h2>
                            <p style="font-size: 16px; color: #444;">
                                Please use the following verification code to complete your registration:
                            </p>
                            <div style="margin: 24px 0; text-align: center;">
                                <span style="display: inline-block; font-size: 2em; font-weight: bold; letter-spacing: 8px; background: #f1f5fa; color: #204087; padding: 18px 38px; border-radius: 4px;">
                                    {{code}}
                                </span>
                            </div>
                            <p style="font-size:14px; color:#888;">
                                If you did not request this, you can safely ignore this email.
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

    async setupSystemUser() {
        const SUPER_ADMIN_EMAIL = environment.adminEmail
        const SUPER_ADMIN_PASSWORD = environment.adminPassword
        const isProduction = environment.production

        if (!SUPER_ADMIN_PASSWORD && isProduction) {
            throw new Error(
                'SUPER_ADMIN_PASSWORD environment variable is required in production'
            )
        }

        const defaultPassword = 'ChangeMe123!'
        const password = SUPER_ADMIN_PASSWORD || defaultPassword
    
        // Проверяем существует ли супер-админ
        let superAdmin = await this.prisma.user.findFirst({
            where: { isSuperAdmin: true },
        })
    
        if (superAdmin) {
            console.log('✅ Super admin already exists:', superAdmin.email)
            
            // Если это development и пароль по умолчанию - обновляем
            if (
                !environment.production && 
                SUPER_ADMIN_PASSWORD && 
                superAdmin.email === SUPER_ADMIN_EMAIL
            ) {
                const hashedPassword = await bcrypt.hash(password, 10)
                superAdmin = await this.prisma.user.update({
                    where: { id: superAdmin.id },
                    data: { password: hashedPassword },
                })
                console.log('   Password updated from environment variable')
            }
            
            return
        }
    
        // Создаем системного супер-админа
        const hashedPassword = await bcrypt.hash(password, 10)
    
        superAdmin = await this.prisma.user.create({
            data: {
                email: SUPER_ADMIN_EMAIL,
                password: hashedPassword,
                isSuperAdmin: true,
                firstname: 'System',
                lastname: 'Administrator',
                status: 'ACTIVE',
                language: 'EN',
            },
        })
    
        console.log('✅ Super admin created:', superAdmin.email)

        if (!SUPER_ADMIN_PASSWORD) {
            console.log(
                '⚠️  Using a development default password. Set SUPER_ADMIN_PASSWORD and restart.',
            )
        }
    }

    async setupDefaultWorkspace() {
        const WORKSPACE_KEY = environment.defaultWorkspaceKey
        const WORKSPACE_NAME = environment.defaultWorkspaceName
        const WORKSPACE_ADMIN_EMAIL = environment.defaultWorkspaceAdminEmail
        const isProduction = environment.production

        if (!environment.defaultWorkspaceAdminPassword && isProduction) {
            throw new Error(
                'DEFAULT_WORKSPACE_ADMIN_PASSWORD environment variable is required in production',
            )
        }
        const WORKSPACE_ADMIN_PASSWORD =
            environment.defaultWorkspaceAdminPassword || 'ChangeMe123!'

        const existingWorkspace = await this.prisma.workspace.findUnique({
            where: { key: WORKSPACE_KEY },
        })
    
        if (existingWorkspace) {
            console.log('✅ Default workspace already exists:', existingWorkspace.name)
            return
        }
    
        const adminRole = await this.prisma.role.findUnique({
            where: { name: 'admin' },
        })
    
        if (!adminRole) {
            console.log('⚠️  Admin role not found, skipping workspace creation')
            return
        }
    
        const result = await this.prisma.$transaction(async (tx) => {
            const hashedPassword = await bcrypt.hash(WORKSPACE_ADMIN_PASSWORD, 10)
            
            const workspaceAdmin = await tx.user.create({
                data: {
                    email: WORKSPACE_ADMIN_EMAIL,
                    password: hashedPassword,
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
    
        console.log('✅ Default workspace created:', result.workspace.key)
        console.log('   Admin account:', result.workspaceAdmin.email)
        if (!environment.defaultWorkspaceAdminPassword) {
            console.log(
                '⚠️  Using a development default password. Set DEFAULT_WORKSPACE_ADMIN_PASSWORD and restart.',
            )
        }
    }
    
}
