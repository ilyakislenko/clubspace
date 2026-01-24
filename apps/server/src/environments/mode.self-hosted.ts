import { get } from 'env-var'

export const modeEnvironment: {
    mode: 'saas' | 'self-hosted'
    adminEmail?: string
    adminPassword?: string
    organizationName?: string
} = {
    mode: 'self-hosted',
    adminEmail: get('ADMIN_EMAIL').asEmailString(),
    adminPassword: get('ADMIN_PASSWORD').asString(),
    organizationName: get('ORGANIZATION_NAME').default('Volt').asString(),
}
