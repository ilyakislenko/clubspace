import { Module, ModuleMetadata } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { RolesModule } from '../domains/roles/roles.module'
import { TokensModule } from '../domains/tokens/tokens.module'
import { UsersModule } from '../domains/users/users.module'
import { PrismaModule } from '../infrastructure/prisma'

const controllers: ModuleMetadata['controllers'] = []
const providers: ModuleMetadata['providers'] = []

const imports: ModuleMetadata['imports'] = []

const coreModules: ModuleMetadata['imports'] = [
    PrismaModule.forRoot({
        url: process.env.DATABASE_URL ?? '',
    }),
    JwtModule.register({ global: true }),
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
]

@Module({
    imports: [...coreModules, ...domainModules],
})
export class AppModule {}
