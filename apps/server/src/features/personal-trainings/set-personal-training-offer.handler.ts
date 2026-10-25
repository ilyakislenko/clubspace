import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    SetPersonalTrainingOfferFeature,
    SetPersonalTrainingOfferFeatureResponse,
} from './set-personal-training-offer.feature'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

@Feature(SetPersonalTrainingOfferFeature)
export class SetPersonalTrainingOfferHandler
    implements
        IFeatureHandler<
            SetPersonalTrainingOfferFeature,
            SetPersonalTrainingOfferFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: SetPersonalTrainingOfferFeature) {
        // Any coaching scope may opt in; throws for a plain member.
        await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const where = {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        }
        if (f.payload.enabled) {
            try {
                await this.prisma.personalTrainingCoach.create({ data: where })
            } catch (e) {
                // Already opted in: same end state, so success.
                if (!isP2002(e)) throw e
            }
        } else {
            // Requests already sent to this coach stay answerable.
            await this.prisma.personalTrainingCoach.deleteMany({ where })
        }
        return { offersPersonalTraining: f.payload.enabled }
    }
}
