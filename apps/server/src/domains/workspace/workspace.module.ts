import { DynamicModule, Module, Provider, Type } from '@nestjs/common'

import { WORKSPACE_PUBLISHER } from './configs/workspace-events.config'
import {
    patchWorkspaceConfig,
    WORKSPACE_CONFIG,
    WORKSPACE_OPTIONS_TYPE,
    WorkspaceConfigurableModuleClass,
} from './configs/workspace-module.config'
import { WorkspaceService } from './services/workspace.service'
import { WorkspaceUserService } from './services/workspace-user.service'

@Module({})
export class WorkspaceModule extends WorkspaceConfigurableModuleClass {
    static forRoot(options: typeof WORKSPACE_OPTIONS_TYPE): DynamicModule {
        const imports: any[] = []
        const controllers: Type<any>[] = []
        const providers: Provider[] = [
            {
                provide: WORKSPACE_CONFIG,
                useValue: patchWorkspaceConfig(options),
            },
            {
                provide: WORKSPACE_PUBLISHER,
                ...options.eventsProvider,
            },
            WorkspaceUserService,
            WorkspaceService,
        ]

        return {
            module: WorkspaceModule,
            imports,
            controllers,
            providers,
            exports: providers,
        }
    }
}
