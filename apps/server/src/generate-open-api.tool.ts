import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { config } from 'dotenv'
import { writeFileSync } from 'fs'
import { cleanupOpenApiDoc } from 'nestjs-zod'
import { join } from 'path'
import { exit } from 'process'
import { AppModule } from './app/app.module'

config()

async function bootstrap() {
    const app = await NestFactory.create(AppModule)

    const config = new DocumentBuilder()
        .setTitle('Level platform API')
        .setVersion('1.0')
        .addTag('API', 'API reference documentation')
        .build()

    const documentFactory = () =>
        SwaggerModule.createDocument(app, config, {
            autoTagControllers: false,
            operationIdFactory: (controllerKey: string, methodKey: string) => {
                return `${methodKey}`
            },
        })

    const openApiDoc = cleanupOpenApiDoc(documentFactory())

    writeFileSync(
        join(process.cwd(), '/open-api.json'),
        JSON.stringify(openApiDoc, null, 2),
    )

    console.log('Open API generated successfully')

    exit(0)
}

bootstrap()
