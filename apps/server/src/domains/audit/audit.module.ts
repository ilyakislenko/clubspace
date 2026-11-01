import { Global, Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { AuditService } from './services/audit.service'
import { PlatformAccessAuditService } from './services/platform-access-audit.service'

@Global()
@Module({
    imports: [PrismaModule],
    providers: [AuditService, PlatformAccessAuditService],
    exports: [AuditService, PlatformAccessAuditService],
})
export class AuditModule {}
