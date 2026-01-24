import { ConfigurableModuleBuilder } from '@nestjs/common'

export interface EmailTemplatesConfig {
    test?: boolean
}

export const DEFAULT_EMAIL_TEMPLATES_CONFIG: Pick<
    EmailTemplatesConfig,
    'test'
> = {
    test: false,
}

export function patchEmailTemplatesConfig(
    config: Pick<
        typeof EMAIL_TEMPLATES_OPTIONS_TYPE,
        keyof typeof DEFAULT_EMAIL_TEMPLATES_CONFIG
    >,
) {
    return {
        ...DEFAULT_EMAIL_TEMPLATES_CONFIG,
        ...config,
    }
}

export const {
    ConfigurableModuleClass: EmailTemplatesConfigurableModuleClass,
    MODULE_OPTIONS_TOKEN: EMAIL_TEMPLATES_CONFIG,
    ASYNC_OPTIONS_TYPE: EMAIL_TEMPLATES_ASYNC_OPTIONS_TYPE,
    OPTIONS_TYPE: EMAIL_TEMPLATES_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<EmailTemplatesConfig, 'forRoot'>({
    optionsInjectionToken: `EMAIL_TEMPLATES_CONFIG`,
}).build()
