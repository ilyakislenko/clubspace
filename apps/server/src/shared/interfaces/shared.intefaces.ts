// Values are lowercased before they hit the DB (RolesService.createDefaultRole),
// so these must lowercase to the canonical RoleName values that the RoleGuard
// tiers compare against (see shared/decorators/roles.decorator.ts).
export enum RolesEnum {
    USER = 'User',
    ADMIN = 'Admin',
    GLOBAL_ADMIN = 'Global Admin',
    HEAD_COACH = 'head_coach',
    COACH = 'coach',
}

export enum RoleFeaturesEnum {
    GET_MY_DATA = 'GET_MY_DATA',
    MANAGE_USERS = 'MANAGE_USERS',
    MANAGE_PARTNERS = 'MANAGE_PARTNERS',
    MANAGE_PLANS = 'MANAGE_PLANS',
    MANAGE_SUPPORT = 'MANAGE_SUPPORT',
    MANAGE_POSTS = 'MANAGE_POSTS',
}

export interface UserPayload {
    userId: string
    email: string
}
