import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetPersonalTrainingFeature,
    GetPersonalTrainingFeatureResponse,
} from './get-personal-training.feature'
import {
    loadRequestOrThrow,
    resolvePersonalTrainingActor,
} from './personal-training-access'
import { serializePersonalTraining } from './schemas'

@Feature(GetPersonalTrainingFeature)
export class GetPersonalTrainingHandler
    implements
        IFeatureHandler<
            GetPersonalTrainingFeature,
            GetPersonalTrainingFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetPersonalTrainingFeature) {
        const request = await loadRequestOrThrow(
            this.prisma,
            f.workspaceId,
            f.requestId,
        )
        await resolvePersonalTrainingActor(this.rbac, f, request)
        return serializePersonalTraining(request, new Date())
    }
}
