export enum RolesEnum {
    PRE_USER = 'Pre User',
    USER = 'User',
    ADMIN = 'Admin',
    MODERATOR = 'Moderator',
}

export enum RoleFeaturesEnum {
    GET_MY_DATA = 'GET_MY_DATA',
    MANAGE_USERS = 'MANAGE_USERS',
    MANAGE_PARTNERS = 'MANAGE_PARTNERS',
    MANAGE_CITIES = 'MANAGE_CITIES',
    MANAGE_PLANS = 'MANAGE_PLANS',
    MANAGE_SUPPORT = 'MANAGE_SUPPORT',
    MANAGE_POSTS = 'MANAGE_POSTS',
}

export interface UserPayload {
    userId: string
    email: string
}
