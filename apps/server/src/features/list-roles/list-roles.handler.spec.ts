import { GRANTABLE_ROLE_NAMES } from '../../shared/decorators/roles.decorator'
import { ListRolesHandler } from './list-roles.handler'

describe('ListRolesHandler', () => {
    it('only lists the roles a club admin can grant', async () => {
        const findMany = jest.fn().mockResolvedValue([
            { id: 'r1', name: 'admin', superuser: false, editable: false },
        ])
        const handler = new ListRolesHandler({ role: { findMany } } as never)

        const out = await handler.execute()

        expect(findMany.mock.calls[0][0].where).toEqual({
            name: { in: GRANTABLE_ROLE_NAMES },
        })
        expect(GRANTABLE_ROLE_NAMES).not.toContain('moderator')
        expect(out.data).toEqual([
            { id: 'r1', name: 'admin', superuser: false, editable: false },
        ])
    })
})
