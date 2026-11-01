import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetCourseAudienceFeature,
    GetCourseAudienceFeatureResponse,
} from './get-course-audience.feature'
import { loadCourseAudience } from './schemas'

@Feature(GetCourseAudienceFeature)
export class GetCourseAudienceHandler
    implements
        IFeatureHandler<
            GetCourseAudienceFeature,
            GetCourseAudienceFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetCourseAudienceFeature) {
        // Content is managed by the coaching staff (same tier as the course
        // editor); resolveCoachScope refuses a student.
        await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        return loadCourseAudience(this.prisma, f.workspaceId, f.courseId)
    }
}
