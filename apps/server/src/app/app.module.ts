import { Module, ModuleMetadata } from '@nestjs/common'
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { FeaturesModule } from '@shelfjs/features'
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod'
import { RolesModule } from '../domains/roles/roles.module'
import type { TfaEventsPublisher } from '../domains/tfa/configs/tfa-events.config'
import { TfaModule } from '../domains/tfa/tfa.module'
import { TokensModule } from '../domains/tokens/tokens.module'
import { UsersModule } from '../domains/users/users.module'
import { SignInController } from '../features/sign-in/sign-in.controller'
import { SignInHandler } from '../features/sign-in/sign-in.handler'
import { PrismaModule } from '../infrastructure/prisma'
import { LoggingInterceptor } from '../shared/interceptors/logging.interceptor'

const coreModules: ModuleMetadata['imports'] = [
    FeaturesModule.forRoot({}),
    PrismaModule.forRoot({
        url: process.env.DATABASE_URL ?? '',
    }),
    JwtModule.register({ global: true }),
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
export class AppModule {}
