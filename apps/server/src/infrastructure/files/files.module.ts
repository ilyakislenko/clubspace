import { DiscoveryModule } from '@golevelup/nestjs-discovery'
import { DynamicModule, Global, Module, Provider, Type } from '@nestjs/common'

import {
    FILES_CONFIG,
    FILES_OPTIONS_TYPE,
    FilesConfigurableModuleClass,
    patchFilesConfig,
} from './files.config'
import { FilesService } from './services/files.service'

@Global()
@Module({})
export class FilesModule extends FilesConfigurableModuleClass {
    static forRoot(options: typeof FILES_OPTIONS_TYPE): DynamicModule {
        const imports: any[] = [DiscoveryModule]
        const controllers: Type<any>[] = []
        const exports: any[] = [FILES_CONFIG, FilesService]
        const providers: Provider[] = [
            {
                provide: FILES_CONFIG,
                useValue: patchFilesConfig(options),
            },
            FilesService,
        ]

        return {
            module: FilesModule,
            imports,
            controllers,
            providers,
            exports,
        }
    }
}
