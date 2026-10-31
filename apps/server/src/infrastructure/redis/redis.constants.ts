export const REDIS_CLIENT = 'REDIS_CLIENT'

export interface RedisConfig {
    host: string
    port: number
    password?: string
    db?: number
}
