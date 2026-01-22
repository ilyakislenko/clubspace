import { ConfigurableModuleBuilder } from '@nestjs/common'

export interface RolesConfig {
    test?: boolean
}

export const DEFAULT_ROLES_CONFIG: Pick<RolesConfig, 'test'> = {
    test: false,
}

export function patchRolesConfig(
    config: Pick<typeof ROLES_OPTIONS_TYPE, keyof typeof DEFAULT_ROLES_CONFIG>,
) {
    return {
        ...DEFAULT_ROLES_CONFIG,
        ...config,
    }
}

export const {
    ConfigurableModuleClass: ROLESConfigurableModuleClass,
    MODULE_OPTIONS_TOKEN: ROLES_CONFIG,
    ASYNC_OPTIONS_TYPE: ROLES_ASYNC_OPTIONS_TYPE,
    OPTIONS_TYPE: ROLES_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<RolesConfig, 'forRoot'>({
    optionsInjectionToken: `ROLES_CONFIG`,
}).build()
