import { get } from 'env-var'

export const modeEnvironment: {
    mode: 'saas' | 'self-hosted'
    adminEmail?: string
    adminPassword?: string
    organizationName?: string
} = {
    mode: 'self-hosted',
    adminEmail: get('SUPER_ADMIN_EMAIL').asEmailString(),
    adminPassword: get('SUPER_ADMIN_PASSWORD').asString(),
    organizationName: get('ORGANIZATION_NAME').default('BJJ_Academy').asString(),
}
