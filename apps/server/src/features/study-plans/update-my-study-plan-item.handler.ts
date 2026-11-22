import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { loadOwnPlan, loadPlanDetail, touchPlan } from './schemas'
import { isValidItemRange } from './study-plans-utils'
import {
    UpdateMyStudyPlanItemFeature,
    UpdateMyStudyPlanItemFeatureResponse,
} from './update-my-study-plan-item.feature'

@Feature(UpdateMyStudyPlanItemFeature)
export class UpdateMyStudyPlanItemHandler
    implements
        IFeatureHandler<
            UpdateMyStudyPlanItemFeature,
            UpdateMyStudyPlanItemFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute(
        f: UpdateMyStudyPlanItemFeature,
    ): Promise<UpdateMyStudyPlanItemFeatureResponse> {
        const plan = await loadOwnPlan(this.prisma, f)
        const item = await this.prisma.studyPlanItem.findUnique({
            where: { id: f.itemId },
        })
        if (!item || item.planId !== plan.id) {
            throw new NotFoundError({ message: 'Фрагмент плана не найден' })
        }
        const { title, note, startSec, endSec } = f.payload
        const nextStart = startSec ?? item.startSec
        const nextEnd = endSec === undefined ? item.endSec : endSec
        if (!isValidItemRange(nextStart, nextEnd)) {
            throw new BadRequestError({
                message: 'Конец отрезка должен быть позже начала',
            })
        }
        await this.prisma.studyPlanItem.update({
            where: { id: item.id },
            data: {
                startSec: nextStart,
                endSec: nextEnd,
                ...(title !== undefined && { title }),
                ...(note !== undefined && { note: note || null }),
            },
        })
        const touched = await touchPlan(this.prisma, plan.id)
        return await loadPlanDetail(this.prisma, this.courseAccess, touched)
    }
}
