import { ConfigurableModuleBuilder } from '@nestjs/common'

import { WorkspaceEventPublisherProvider } from './workspace-events.config'

export interface WorkspaceConfig {
    eventsProvider: WorkspaceEventPublisherProvider
    encryptionKey: string
    test?: boolean
}

export const DEFAULT_WORKSPACE_CONFIG: Pick<WorkspaceConfig, 'test'> = {
    test: false,
}

export function patchWorkspaceConfig(
    config: Pick<
        typeof WORKSPACE_OPTIONS_TYPE,
        keyof typeof DEFAULT_WORKSPACE_CONFIG
    >,
) {
    return {
        ...DEFAULT_WORKSPACE_CONFIG,
        ...config,
    }
}

export const {
    ConfigurableModuleClass: WorkspaceConfigurableModuleClass,
    MODULE_OPTIONS_TOKEN: WORKSPACE_CONFIG,
    ASYNC_OPTIONS_TYPE: WORKSPACE_ASYNC_OPTIONS_TYPE,
    OPTIONS_TYPE: WORKSPACE_OPTIONS_TYPE,
} = new ConfigurableModuleBuilder<WorkspaceConfig, 'forRoot'>({
    optionsInjectionToken: `WORKSPACE_CONFIG`,
}).build()
