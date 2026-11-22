import { get } from 'env-var'

/**
 * Browser origins allowed to call the API (HTTP and the realtime socket),
 * from CORS_ORIGINS. `*` in the list means "any origin" — refused in
 * production by main.ts. Native mobile clients send no Origin and are not
 * affected by CORS either way.
 */
export const resolveCorsOrigins = (): { origins: string[]; allowAnyOrigin: boolean } => {
    const origins = get('CORS_ORIGINS')
        .default('http://localhost:3000,http://localhost:4200,http://localhost:4201')
        .asString()
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    return { origins, allowAnyOrigin: origins.includes('*') }
}
