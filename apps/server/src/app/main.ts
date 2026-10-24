import { initSentry } from './sentry'

const sentryEnabled = initSentry()

import { NestFactory } from '@nestjs/core'
import { apiReference } from '@scalar/nestjs-api-reference'
import { Logger } from '@shelfjs/logger'
import { get } from 'env-var'

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { cleanupOpenApiDoc } from 'nestjs-zod'
import { AppModule } from './app.module'
import { environment } from '../environments/environment'
import { resolveStoreReview } from '../shared/utils/store-review.util'

const logger = new Logger()

// Fail fast in production if either signing secret is missing or weak.
// Running with a short / default secret would silently accept forged
// access tokens or playback URLs, so we'd rather crash the container.
const assertProductionSecrets = () => {
    if (!environment.production) return

    const MIN_LENGTH = 32
    const checks: Array<[string, string | undefined]> = [
        ['JWT_SECRET', environment.jwt.secret],
        ['PLAYBACK_TOKEN_SECRET', environment.playbackTokenSecret],
    ]

    for (const [name, value] of checks) {
        if (!value) {
            throw new Error(
                `[startup] ${name} must be set in production`,
            )
        }
        if (value.length < MIN_LENGTH) {
            throw new Error(
                `[startup] ${name} must be at least ${MIN_LENGTH} characters in production (got ${value.length})`,
            )
        }
    }

    if (environment.jwt.secret === environment.playbackTokenSecret) {
        throw new Error(
            '[startup] JWT_SECRET and PLAYBACK_TOKEN_SECRET must be distinct values',
        )
    }
}

assertProductionSecrets()

// Misconfigured review credentials must fail at start, not at sign-in.
resolveStoreReview({
    email: environment.storeReview.email,
    code: environment.storeReview.code,
    adminEmail: environment.adminEmail,
})

logger.configure({
    json: get('NODE_ENV').asString() === 'production',
})

if (sentryEnabled) {
    logger.log('Sentry initialized')
}

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { logger })

    // Graceful shutdown: on a deploy signal, stop accepting connections and let
    // Nest run lifecycle hooks (Prisma disconnect, BullMQ workers, pending
    // Sentry flush) instead of process.exit(0)'ing mid-request. A hard timeout
    // still forces exit so a hung close can't wedge the container.
    const shutdown = async (signal: string) => {
        logger.log(`Stopping APP, got signal "${signal}"`)
        const force = setTimeout(() => process.exit(1), 10_000)
        force.unref()
        try {
            await app.close()
        } catch (error) {
            logger.error(error)
        }
        process.exit(0)
    }
    process.once('SIGINT', () => void shutdown('SIGINT'))
    process.once('SIGTERM', () => void shutdown('SIGTERM'))

    // Behind Caddy in prod the client IP arrives via X-Forwarded-For. Trust
    // exactly one proxy hop so the throttler rate-limits per real client IP
    // instead of collapsing every request onto the proxy's single address.
    // (Harmless in dev where no proxy sets the header.)
    app.getHttpAdapter().getInstance().set('trust proxy', 1)

    const corsOrigins = get('CORS_ORIGINS')
        .default('http://localhost:3000,http://localhost:4200,http://localhost:4201')
        .asString()
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)

    const allowAnyOrigin = corsOrigins.includes('*')
    const isProduction = environment.production

    // A wildcard origin reflected back WITH credentials lets any site make
    // credentialed cross-origin requests — they're mutually exclusive. Refuse
    // wildcard outright in production; in dev allow it but drop credentials.
    if (allowAnyOrigin && isProduction) {
        throw new Error(
            '[startup] CORS_ORIGINS must list explicit origins in production, not "*"',
        )
    }

    app.enableCors({
        origin: allowAnyOrigin ? true : corsOrigins,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        credentials: !allowAnyOrigin,
    })

    const port = get('SERVER_PORT').default(3000).asPortNumber()

    const config = new DocumentBuilder()
        .setTitle('Level platform API')
        .setVersion('1.0')
        .addTag('Authentication', 'User authentication and authorization')
        .addTag(
            'Two-Factor Authentication',
            'Two-factor authentication management',
        )
        .addTag('Users', 'User profile and management')
        .addTag('Partners', 'Partner management and operations')
        .addTag('Wishlist', 'User wishlist operations')
        .addTag('Cities', 'City data')
        .addTag('Files', 'File upload operations')
        .addBearerAuth(
            {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            },
            'user',
        )
        .addBearerAuth(
            {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            },
            'admin',
        )
        .addBearerAuth(
            {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            },
            'moderator',
        )
        .build()

    const documentFactory = () =>
        SwaggerModule.createDocument(app, config, {
            autoTagControllers: false,
            operationIdFactory: (controllerKey: string, methodKey: string) => {
                return `${methodKey}`
            },
        })

    app.use(
        '/api',
        apiReference({
            content: cleanupOpenApiDoc(documentFactory()),
            hideModels: true,
            hideClientButton: true,
            defaultOpenAllTags: true,
            persistAuth: true,
        }),
    )

    await app.listen(port)

    logger.log(`🔗 API Reference: http://localhost:${port}/api`)
    logger.log(`🚀 Application is running on: http://localhost:${port}`)
}

bootstrap()
