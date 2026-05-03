import { MailerModule } from '@nestjs-modules/mailer'
import { Module, ModuleMetadata } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { BullModule } from '@nestjs/bullmq'
import {
    createEventEmitterListener,
    createEventEmitterPublisher,
} from '@shelfjs/events/src/lib/services/event-emitter-events.service'
import { FeaturesModule } from '@shelfjs/features'

import { EventEmitterModule } from '@nestjs/event-emitter'
import * as bcrypt from 'bcrypt'
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod'
import { AuditModule } from '../domains/audit/audit.module'
import { EmailTemplatesModule } from '../domains/email-templates/email-templates.module'
import { EmailTemplatesService } from '../domains/email-templates/services/email-templates.service'
import { NOTIFICATIONS_LISTENER } from '../domains/notifications/configs/notifications-events.config'
import { NotificationsModule } from '../domains/notifications/notifications.module'
import { PlaylistModule } from '../domains/playlist/playlist.module'
import { RolesModule } from '../domains/roles/roles.module'
import { RolesService } from '../domains/roles/services/roles.service'
import type { TfaEventsPublisher } from '../domains/tfa/configs/tfa-events.config'
import { TfaRequestGroupEnum } from '../domains/tfa/interfaces/tfa.interfaces'
import { TfaService } from '../domains/tfa/services/tfa.service'
import { TfaModule } from '../domains/tfa/tfa.module'
import { TokensModule } from '../domains/tokens/tokens.module'
import { USERS_LISTENER } from '../domains/users/configs/users-events.config'
import { UsersModule } from '../domains/users/users.module'
import { VideoReadyProcessor } from '../domains/video/services/video-ready.processor'
import { VideoModule } from '../domains/video/video.module'
import { WorkspaceModule } from '../domains/workspace/workspace.module'
import { environment } from '../environments/environment'
import { CreatePlaylistController } from '../features/create-playlist/create-playlist.controller'
import { CreatePlaylistHandler } from '../features/create-playlist/create-playlist.handler'
import { CreatePlaylistThumbnailUploadController } from '../features/create-playlist-thumbnail-upload/create-playlist-thumbnail-upload.controller'
import { CreatePlaylistThumbnailUploadHandler } from '../features/create-playlist-thumbnail-upload/create-playlist-thumbnail-upload.handler'
import { DeletePlaylistController } from '../features/delete-playlist/delete-playlist.controller'
import { DeletePlaylistHandler } from '../features/delete-playlist/delete-playlist.handler'
import { FileContentReportController } from '../features/file-content-report/file-content-report.controller'
import { FileContentReportHandler } from '../features/file-content-report/file-content-report.handler'
import { GetMeController } from '../features/get-me/get-me.controller'
import { GetMeHandler } from '../features/get-me/get-me.handler'
import { GetMyWorkspacesController } from '../features/get-my-workspaces/get-my-workspaces.controller'
import { GetMyWorkspacesHandler } from '../features/get-my-workspaces/get-my-workspaces.handler'
import { GetWorkspaceStatsController } from '../features/get-workspace-stats/get-workspace-stats.controller'
import { GetWorkspaceStatsHandler } from '../features/get-workspace-stats/get-workspace-stats.handler'
import { HealthController } from '../features/health/health.controller'
import { ListAuditEventsController } from '../features/list-audit-events/list-audit-events.controller'
import { ListAuditEventsHandler } from '../features/list-audit-events/list-audit-events.handler'
import { AddWorkspaceMemberController } from '../features/add-workspace-member/add-workspace-member.controller'
import { AddWorkspaceMemberHandler } from '../features/add-workspace-member/add-workspace-member.handler'
import { ListWorkspaceMembersController } from '../features/list-workspace-members/list-workspace-members.controller'
import { ListWorkspaceMembersHandler } from '../features/list-workspace-members/list-workspace-members.handler'
import { GetMyWorkspaceMembershipController } from '../features/get-my-workspace-membership/get-my-workspace-membership.controller'
import { GetMyWorkspaceMembershipHandler } from '../features/get-my-workspace-membership/get-my-workspace-membership.handler'
import { FirebaseDevicesController } from '../features/register-firebase-device/firebase-devices.controller'
import { RegisterFirebaseDeviceHandler } from '../features/register-firebase-device/register-firebase-device.handler'
import { UnregisterFirebaseDeviceHandler } from '../features/register-firebase-device/unregister-firebase-device.handler'
import { RemoveWorkspaceMemberController } from '../features/remove-workspace-member/remove-workspace-member.controller'
import { RemoveWorkspaceMemberHandler } from '../features/remove-workspace-member/remove-workspace-member.handler'
import { UpdateWorkspaceMemberAccessController } from '../features/update-workspace-member-access/update-workspace-member-access.controller'
import { UpdateWorkspaceMemberAccessHandler } from '../features/update-workspace-member-access/update-workspace-member-access.handler'
import { GetPlaylistController } from '../features/get-playlist/get-playlist.controller'
import { GetPlaylistHandler } from '../features/get-playlist/get-playlist.handler'
import { ListPlaylistsController } from '../features/get-playlists/list-playlists.controller'
import { ListPlaylistsHandler } from '../features/get-playlists/list-playlists.handler'
import { RefreshTokenController } from '../features/refresh-token/refresh-token.controller'
import { RefreshTokenHandler } from '../features/refresh-token/refresh-token.handler'
import { ResendCodeController } from '../features/resend-code/resend-code.controller'
import { ResendCodeHandler } from '../features/resend-code/resend-code.handler'
import { SendAuthCodeController } from '../features/send-auth-code/send-auth-code.controller'
import { SendAuthCodeHandler } from '../features/send-auth-code/send-auth-code.handler'
import { SendEmailNotificationListener } from '../features/send-email-notification/send-email-notification.listener'
import { SendNotificationHandler } from '../features/send-notification/send-notification.handler'
import { SendNotificationListener } from '../features/send-notification/send-notification.listener'
import { SignInController } from '../features/sign-in/sign-in.controller'
import { SignInHandler } from '../features/sign-in/sign-in.handler'
import { UpdatePlaylistController } from '../features/update-playlist/update-playlist.controller'
import { UpdatePlaylistHandler } from '../features/update-playlist/update-playlist.handler'
import { CompleteVideoUploadController } from '../features/complete-video-upload/complete-video-upload.controller'
import { CompleteVideoUploadHandler } from '../features/complete-video-upload/complete-video-upload.handler'
import { CreateVideoUploadController } from '../features/create-video-upload/create-video-upload.controller'
import { CreateVideoUploadHandler } from '../features/create-video-upload/create-video-upload.handler'
import { CreateVideoThumbnailUploadController } from '../features/create-video-thumbnail-upload/create-video-thumbnail-upload.controller'
import { CreateVideoThumbnailUploadHandler } from '../features/create-video-thumbnail-upload/create-video-thumbnail-upload.handler'
import { CreateCategoryController } from '../features/create-category/create-category.controller'
import { CreateCategoryHandler } from '../features/create-category/create-category.handler'
import { CreateTagController } from '../features/create-tag/create-tag.controller'
import { CreateTagHandler } from '../features/create-tag/create-tag.handler'
import { DeleteVideoController } from '../features/delete-video/delete-video.controller'
import { DeleteVideoHandler } from '../features/delete-video/delete-video.handler'
import { DeleteCategoryController } from '../features/delete-category/delete-category.controller'
import { DeleteCategoryHandler } from '../features/delete-category/delete-category.handler'
import { DeleteTagController } from '../features/delete-tag/delete-tag.controller'
import { DeleteTagHandler } from '../features/delete-tag/delete-tag.handler'
import { GetVideoManifestController } from '../features/get-video-manifest/get-video-manifest.controller'
import { GetVideoPlaybackController } from '../features/get-video-playback/get-video-playback.controller'
import { GetVideoPlaybackHandler } from '../features/get-video-playback/get-video-playback.handler'
import { GetVideoController } from '../features/get-video/get-video.controller'
import { GetVideoHandler } from '../features/get-video/get-video.handler'
import { GetWorkspaceVideoController } from '../features/get-video/get-workspace-video.controller'
import { ListCategoriesController } from '../features/list-categories/list-categories.controller'
import { ListCategoriesHandler } from '../features/list-categories/list-categories.handler'
import { ListTagsController } from '../features/list-tags/list-tags.controller'
import { ListTagsHandler } from '../features/list-tags/list-tags.handler'
import { ListVideosController } from '../features/list-videos/list-videos.controller'
import { ListVideosHandler } from '../features/list-videos/list-videos.handler'
import { UpdateCategoryController } from '../features/update-category/update-category.controller'
import { UpdateCategoryHandler } from '../features/update-category/update-category.handler'
import { UpdateTagController } from '../features/update-tag/update-tag.controller'
import { UpdateTagHandler } from '../features/update-tag/update-tag.handler'
import { UpdateVideoController } from '../features/update-video/update-video.controller'
import { UpdateVideoHandler } from '../features/update-video/update-video.handler'
import { FilesModule } from '../infrastructure/files/files.module'
import { PrismaModule } from '../infrastructure/prisma'
import { PrismaService } from '../infrastructure/prisma/prisma.service'
import { QueueModule } from '../infrastructure/queue/queue.module'
import { LoggingInterceptor } from '../shared/interceptors/logging.interceptor'
import { RoleFeaturesEnum, RolesEnum } from '../shared/interfaces/shared.intefaces'
const coreModules: ModuleMetadata['imports'] = [
    FeaturesModule.forRoot({}),
    EventEmitterModule.forRoot(),
    PrismaModule.forRoot({
        url: environment.databaseUrl,
    }),
    FilesModule.forRoot({
        ...environment.s3Storage,
    }),
    QueueModule.forRoot({
        host: environment.redis.host,
        port: environment.redis.port,
        password: environment.redis.password,
        db: environment.redis.db,
    }),
    JwtModule.register({ global: true }),
    MailerModule.forRoot({
        defaults: {
            from: environment.notifications.defaults.from,
        },
        transport: environment.notifications.transport,
    }),
    EmailTemplatesModule.forRoot({}),
    NotificationsModule.forRoot({
        eventsProvider: createEventEmitterPublisher(),
    }),
    ThrottlerModule.forRoot([
        { name: 'short', ttl: 1_000, limit: 5 },
        { name: 'default', ttl: 60_000, limit: 120 },
    ]),
    BullModule.registerQueue({ name: 'video-transcode' }),
]

const controllers: ModuleMetadata['controllers'] = [
    SignInController,
    SendAuthCodeController,
    ResendCodeController,
    RefreshTokenController,
    GetMyWorkspacesController,
    CreateVideoUploadController,
    CreateVideoThumbnailUploadController,
    CreateTagController,
    CreateCategoryController,
    CompleteVideoUploadController,
    GetVideoController,
    GetWorkspaceVideoController,
    GetVideoPlaybackController,
    GetVideoManifestController,
    ListVideosController,
    DeleteVideoController,
    UpdateVideoController,
    ListTagsController,
    ListCategoriesController,
    UpdateTagController,
    UpdateCategoryController,
    DeleteTagController,
    DeleteCategoryController,
    CreatePlaylistController,
    CreatePlaylistThumbnailUploadController,
    ListPlaylistsController,
    GetPlaylistController,
    UpdatePlaylistController,
    DeletePlaylistController,
    AddWorkspaceMemberController,
    ListWorkspaceMembersController,
    GetMyWorkspaceMembershipController,
    RemoveWorkspaceMemberController,
    UpdateWorkspaceMemberAccessController,
    FirebaseDevicesController,
    HealthController,
    ListAuditEventsController,
    GetWorkspaceStatsController,
    GetMeController,
    FileContentReportController,
]

const handlers: ModuleMetadata['providers'] = [
    SignInHandler,
    SendAuthCodeHandler,
    ResendCodeHandler,
    SendNotificationHandler,
    RefreshTokenHandler,
    GetMyWorkspacesHandler,
    CreateVideoUploadHandler,
    CreateVideoThumbnailUploadHandler,
    CreateTagHandler,
    CreateCategoryHandler,
    CompleteVideoUploadHandler,
    GetVideoHandler,
    GetVideoPlaybackHandler,
    ListVideosHandler,
    DeleteVideoHandler,
    UpdateVideoHandler,
    ListTagsHandler,
    ListCategoriesHandler,
    UpdateTagHandler,
    UpdateCategoryHandler,
    DeleteTagHandler,
    DeleteCategoryHandler,
    CreatePlaylistHandler,
    CreatePlaylistThumbnailUploadHandler,
    UpdatePlaylistHandler,
    DeletePlaylistHandler,
    ListPlaylistsHandler,
    GetPlaylistHandler,
    AddWorkspaceMemberHandler,
    ListWorkspaceMembersHandler,
    GetMyWorkspaceMembershipHandler,
    RegisterFirebaseDeviceHandler,
    UnregisterFirebaseDeviceHandler,
    RemoveWorkspaceMemberHandler,
    UpdateWorkspaceMemberAccessHandler,
    ListAuditEventsHandler,
    GetWorkspaceStatsHandler,
    GetMeHandler,
    FileContentReportHandler,
    VideoReadyProcessor,
]



const domainModules: ModuleMetadata['imports'] = [
    TokensModule.forRoot({
        jwt: {
            secret: environment.jwt.secret,
            issuerUrl: environment.jwt.issuerUrl,
            audienceUrl: environment.jwt.audienceUrl,
            accessTokenTTL: environment.jwt.accessTokenTTL,
            refreshTokenTTL: environment.jwt.refreshTokenTTL,
        },
    }),
    RolesModule.forRoot({}),
    UsersModule.forRoot({
        eventsProvider: createEventEmitterPublisher(),
        completeCodeTimeout: environment.completeCodeTimeout
    }),
    TfaModule.forRoot({
        eventsProvider: {
            useFactory: (): TfaEventsPublisher => ({
                send: async () => undefined,
            }),
        },
        encryptionKey: environment.encryptionKey,
    }),
    WorkspaceModule.forRoot({
        eventsProvider: createEventEmitterPublisher(),
        encryptionKey: environment.encryptionKey,
    }),
    VideoModule,
    PlaylistModule,
    AuditModule,
]

const listeners: ModuleMetadata['providers'] = [
    createEventEmitterListener({
        injectionToken: USERS_LISTENER,
    }),
    createEventEmitterListener({
        injectionToken: NOTIFICATIONS_LISTENER,
    }),
    SendNotificationListener,
    SendEmailNotificationListener
]

@Module({
  imports: [...coreModules, ...domainModules],
  controllers: [...controllers],
  providers: [
      {
          provide: APP_PIPE,
          useClass: ZodValidationPipe,
      },
      {
          provide: APP_INTERCEPTOR,
          useClass: ZodSerializerInterceptor,
      },
      {
          provide: APP_INTERCEPTOR,
          useClass: LoggingInterceptor,
      },
      {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
      },
      ...handlers,
      ...listeners,
  ],
})
export class AppModule {
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
        
        if (!SUPER_ADMIN_PASSWORD && environment.production) {
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
    
        console.log('\n' + '='.repeat(60))
        console.log('✅ SUPER ADMIN CREATED')
        console.log('='.repeat(60))
        console.log('   Email:   ', superAdmin.email)
        console.log('   Password:', password)
        
        if (!SUPER_ADMIN_PASSWORD) {
            console.log('\n⚠️  WARNING: Using default password!')
            console.log('   Please set SUPER_ADMIN_PASSWORD in .env')
            console.log('   Then restart the application')
        }
        
        console.log('='.repeat(60) + '\n')
    }

    async setupDefaultWorkspace() {
        const WORKSPACE_KEY = environment.defaultWorkspaceKey
        const WORKSPACE_NAME = environment.defaultWorkspaceName
        const WORKSPACE_ADMIN_EMAIL = 'admin@bjj-academy.com'
        const WORKSPACE_ADMIN_PASSWORD = 'Admin123!'
    
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
    
        console.log('\n' + '='.repeat(70))
        console.log('✅ DEFAULT GRAPPLING WORKSPACE CREATED')
        console.log('='.repeat(70))
        console.log('Workspace:')
        console.log('  Name:         ', result.workspace.name)
        console.log('  Key:          ', result.workspace.key)
        console.log('  Type:         ', result.workspace.type)
        console.log('  URL:          ', `http://localhost:3000/${result.workspace.key}`)
        console.log('')
        console.log('Admin Account:')
        console.log('  Email:        ', result.workspaceAdmin.email)
        console.log('  Password:     ', WORKSPACE_ADMIN_PASSWORD)
        console.log('')
        console.log('Content Created:')
        console.log('  Categories:   ', '7 (Fundamentals, Positions, Submissions, etc.)')
        console.log('  Tags:         ', '26 (Positions, Techniques, Gi-types, Levels)')
        console.log('  Plans:        ', '3 (Monthly, Annual, Lifetime)')
        console.log('  Courses:      ', '1 (BJJ Fundamentals)')
        console.log('')
        console.log('⚠️  PLEASE CHANGE THE ADMIN PASSWORD IMMEDIATELY!')
        console.log('='.repeat(70) + '\n')
    }
    
}
