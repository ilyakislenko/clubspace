import { initSentry } from './sentry'

const sentryEnabled = initSentry()

import { NestFactory } from '@nestjs/core'
import { apiReference } from '@scalar/nestjs-api-reference'
import { Logger } from '@shelfjs/logger'
import { get } from 'env-var'

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { cleanupOpenApiDoc } from 'nestjs-zod'
import { AppModule } from './app.module'

const logger = new Logger()

logger.configure({
    json: get('NODE_ENV').asString() === 'production',
})

if (sentryEnabled) {
    logger.log('Sentry initialized')
}

process.on('SIGINT', () => {
    logger.log('Stopping APP, got signal "SIGINT"')
    process.exit(0)
})

process.on('SIGTERM', () => {
    logger.log('Stopping APP, got signal "SIGTERM"')
    process.exit(0)
})

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { logger })

    const corsOrigins = get('CORS_ORIGINS')
        .default('http://localhost:3000,http://localhost:4200,http://localhost:4201')
        .asString()
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)

    app.enableCors({
        origin: corsOrigins.includes('*') ? true : corsOrigins,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        credentials: true,
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
