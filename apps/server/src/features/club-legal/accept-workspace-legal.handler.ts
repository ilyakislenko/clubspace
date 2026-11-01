import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ClubLegalService } from '../../domains/billing/services/club-legal.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    ConflictError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    AcceptWorkspaceLegalFeature,
    AcceptWorkspaceLegalFeatureResponse,
} from './accept-workspace-legal.feature'
import { serializeClubLegalStatus } from './schemas'

export const OWNER_ONLY_MESSAGE =
    'Принять договор-оферту и поручение за клуб может только его владелец'

// The club owner accepts the current offer + DPA editions (the banner or the
// «Тариф» page). The owner is the club's party to the contract, so nobody
// else accepts for the club — not another admin, not a platform admin.
@Feature(AcceptWorkspaceLegalFeature)
export class AcceptWorkspaceLegalHandler
    implements
        IFeatureHandler<AcceptWorkspaceLegalFeature, AcceptWorkspaceLegalFeatureResponse>
{
    constructor(
        private readonly rbac: RbacService,
        private readonly legal: ClubLegalService,
    ) {}

    async execute(f: AcceptWorkspaceLegalFeature): Promise<AcceptWorkspaceLegalFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            OWNER_ONLY_MESSAGE,
        )
        const state = await this.legal.getState(f.workspaceId)
        if (state.ownerId !== f.invokerUserId) {
            throw new ForbiddenError({ message: OWNER_ONLY_MESSAGE })
        }

        // Acceptance counts only for the text the owner saw: a page holding an
        // older edition must reload it rather than accept the new one blindly.
        if (
            f.payload.offerVersion !== state.current.offerVersion ||
            f.payload.dpaVersion !== state.current.dpaVersion
        ) {
            throw new ConflictError({
                message: 'Документы обновились. Откройте их заново и примите текущую редакцию.',
            })
        }

        // A double tap or a second tab: the editions are already on record.
        if (state.status.upToDate) {
            return { ...serializeClubLegalStatus(state), canAccept: true }
        }

        await this.legal.accept({
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            source: 'OWNER',
            ip: f.ip,
            userAgent: f.userAgent,
        })
        const after = await this.legal.getState(f.workspaceId)
        return { ...serializeClubLegalStatus(after), canAccept: true }
    }
}
