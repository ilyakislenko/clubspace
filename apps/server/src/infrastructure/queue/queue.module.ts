import { BullModule } from '@nestjs/bullmq'
import { DynamicModule, Module, ModuleMetadata, Provider, Type } from '@nestjs/common'

import {
    QUEUE_CONFIG,
    QUEUE_OPTIONS_TYPE,
    QueueConfigurableModuleClass,
    patchQueueConfig,
} from './queue.config'

@Module({})
export class QueueModule extends QueueConfigurableModuleClass {
    static forRoot(options: typeof QUEUE_OPTIONS_TYPE): DynamicModule {
        const imports: ModuleMetadata['imports'] = [
            BullModule.forRoot({
                connection: {
                    host: options.host,
                    port: options.port,
                    password: options.password,
                    db: options.db,
                },
            }),
        ]
        const controllers: Type<unknown>[] = []
        const exports: ModuleMetadata['exports'] = [QUEUE_CONFIG, BullModule]
        const providers: Provider[] = [
            {
                provide: QUEUE_CONFIG,
                useValue: patchQueueConfig(options),
            },
        ]

        return {
            module: QueueModule,
            imports,
            controllers,
            providers,
            exports,
        }
    }
}
