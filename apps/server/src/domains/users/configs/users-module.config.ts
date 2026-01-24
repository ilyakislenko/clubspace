import { ConfigurableModuleBuilder } from '@nestjs/common'

import { UsersEventPublisherProvider } from './users-events.config'

export interface UsersConfig {
    eventsProvider: UsersEventPublisherProvider
    completeCodeTimeout?: number
    test?: boolean
}

export const DEFAULT_USERS_CONFIG: Pick<
    UsersConfig,
    'test' | 'completeCodeTimeout'
> = {
    test: false,
    completeCodeTimeout: 60 * 1000,
}

export function patchUsersConfig(
    config: Pick<typeof USERS_OPTIONS_TYPE, keyof typeof DEFAULT_USERS_CONFIG>,
) {
    return {
        ...DEFAULT_USERS_CONFIG,
        ...config,
    }
}

export const {
    ConfigurableModuleClass: UsersConfigurableModuleClass,
    MODULE_OPTIONS_TOKEN: USERS_CONFIG,
    ASYNC_OPTIONS_TYPE: USERS_ASYNC_OPTIONS_TYPE,
    OPTIONS_TYPE: USERS_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<UsersConfig, 'forRoot'>({
    optionsInjectionToken: `USERS_CONFIG`,
}).build()
