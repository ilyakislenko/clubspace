import { ConfigurableModuleBuilder } from '@nestjs/common'

import { TfaEventPublisherProvider } from './tfa-events.config'

export interface TfaConfig {
    eventsProvider: TfaEventPublisherProvider
    encryptionKey: string
    test?: boolean
}

export const DEFAULT_TFA_CONFIG: Pick<TfaConfig, 'test'> = {
    test: false,
}

export function patchTfaConfig(
    config: Pick<typeof TFA_OPTIONS_TYPE, keyof typeof DEFAULT_TFA_CONFIG>,
) {
    return {
        ...DEFAULT_TFA_CONFIG,
        ...config,
    }
}

export const {
    ConfigurableModuleClass: TfaConfigurableModuleClass,
    MODULE_OPTIONS_TOKEN: TFA_CONFIG,
    ASYNC_OPTIONS_TYPE: TFA_ASYNC_OPTIONS_TYPE,
    OPTIONS_TYPE: TFA_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<TfaConfig, 'forRoot'>({
    optionsInjectionToken: `TFA_CONFIG`,
}).build()
