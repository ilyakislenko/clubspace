import { MailerModule } from '@nestjs-modules/mailer'
import { Module, ModuleMetadata } from '@nestjs/common'
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { FeaturesModule } from '@shelfjs/features'
import { get } from 'env-var'
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod'
import { EmailTemplatesModule } from '../domains/email-templates/email-templates.module'
import { EmailTemplatesService } from '../domains/email-templates/services/email-templates.service'
import { RolesModule } from '../domains/roles/roles.module'
import { RolesService } from '../domains/roles/services/roles.service'
import type { TfaEventsPublisher } from '../domains/tfa/configs/tfa-events.config'
import { TfaRequestGroupEnum } from '../domains/tfa/interfaces/tfa.interfaces'
import { TfaService } from '../domains/tfa/services/tfa.service'
import { TfaModule } from '../domains/tfa/tfa.module'
import { TokensModule } from '../domains/tokens/tokens.module'
import { UsersModule } from '../domains/users/users.module'
import { SignInController } from '../features/sign-in/sign-in.controller'
import { SignInHandler } from '../features/sign-in/sign-in.handler'
import { PrismaModule } from '../infrastructure/prisma'
import { LoggingInterceptor } from '../shared/interceptors/logging.interceptor'
import { RoleFeaturesEnum, RolesEnum } from '../shared/interfaces/shared.intefaces'
import { parseSmtpConnectionUrl } from '../shared/utils/parse-smtp-connection.util'

const coreModules: ModuleMetadata['imports'] = [
    FeaturesModule.forRoot({}),
    PrismaModule.forRoot({
        url: process.env.DATABASE_URL ?? '',
    }),
    JwtModule.register({ global: true }),
    MailerModule.forRoot({
        defaults: {
            from: get('SMTP_NO_REPLY_EMAIL').required().asString(),
        },
        transport: parseSmtpConnectionUrl(
            get('SMTP_URL').required().asUrlString(),
        ),
    }),
    EmailTemplatesModule.forRoot({}),
]

const controllers: ModuleMetadata['controllers'] = [
    SignInController,
]

const handlers: ModuleMetadata['providers'] = [
    SignInHandler,
]



const domainModules: ModuleMetadata['imports'] = [
    TokensModule.forRoot({
        jwt: {
            secret: process.env.JWT_SECRET ?? 'dev-secret',
            issuerUrl: process.env.JWT_ISSUER_URL ?? 'bjj-academy',
            audienceUrl: process.env.JWT_AUDIENCE_URL ?? 'bjj-academy',
            accessTokenTTL: Number(process.env.JWT_ACCESS_TOKEN_TTL ?? 3600),
            refreshTokenTTL: Number(
                process.env.JWT_REFRESH_TOKEN_TTL ?? 60 * 60 * 24 * 30,
            ),
        },
    }),
    RolesModule.forRoot({}),
    UsersModule,
    TfaModule.forRoot({
        eventsProvider: {
            useFactory: (): TfaEventsPublisher => ({
                send: async () => undefined,
            }),
        },
        encryptionKey: process.env.ENCRYPTION_SECRET ?? 'dev-encryption-secret',
    }),
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
      ...handlers,
  ],
})
export class AppModule {
    constructor(
        private readonly tfaService: TfaService,
        private readonly rolesService: RolesService,
        private readonly emailTemplatesService: EmailTemplatesService,
    ) {}

    async onApplicationBootstrap() {
        await this.setupTfa()
        await this.setupRoles()
        await this.setupEmailTemplates()
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
                        RoleFeaturesEnum.MANAGE_CITIES,
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
                        RoleFeaturesEnum.MANAGE_PLANS,
                        RoleFeaturesEnum.MANAGE_CITIES,
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
}
