import { Feature, IFeatureHandler } from '@shelfjs/features'

import { UsersService } from '../../domains/users/services/users.service'
import {
    DeleteAccountFeature,
    DeleteAccountFeatureResponse,
} from './delete-account.feature'

@Feature(DeleteAccountFeature)
export class DeleteAccountHandler
    implements IFeatureHandler<DeleteAccountFeature, DeleteAccountFeatureResponse>
{
    constructor(private readonly users: UsersService) {}

    async execute({
        userId,
    }: DeleteAccountFeature): Promise<DeleteAccountFeatureResponse> {
        await this.users.deleteAccount(userId)
        return { status: 'deleted' as const }
    }
}
