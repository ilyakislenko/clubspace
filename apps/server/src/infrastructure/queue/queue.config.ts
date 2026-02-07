import { ConfigurableModuleBuilder } from '@nestjs/common'
import { merge } from 'lodash'

export interface QueueConfig {
    host: string
    port: number
    password?: string
    db?: number
}

export const DEFAULT_QUEUE_CONFIG = {
    db: 0,
}

export function patchQueueConfig(
    config: Pick<typeof QUEUE_OPTIONS_TYPE, keyof typeof DEFAULT_QUEUE_CONFIG>,
) {
    if (config) {
        Object.assign(
            config,
            merge(DEFAULT_QUEUE_CONFIG, config),
        ) as typeof QUEUE_OPTIONS_TYPE
    }
    return config
}

export const {
    ConfigurableModuleClass: QueueConfigurableModuleClass,
    MODULE_OPTIONS_TOKEN: QUEUE_CONFIG,
    ASYNC_OPTIONS_TYPE: QUEUE_ASYNC_OPTIONS_TYPE,
    OPTIONS_TYPE: QUEUE_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<QueueConfig, 'forRoot'>({
    optionsInjectionToken: `QUEUE_CONFIG`,
}).build()
