import { Global, Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { AuditService } from './services/audit.service'

@Global()
@Module({
    imports: [PrismaModule],
    providers: [AuditService],
    exports: [AuditService],
})
export class AuditModule {}
