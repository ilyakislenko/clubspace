import { randomUUID } from 'crypto'

export class DefaultError extends Error {
    public id = randomUUID()
    public message: string
    public code: string
    public statusCode: number
    public metadata: Record<string, any>

    constructor(payload: {
        code: string
        message: string
        metadata?: Record<string, any>
        statusCode?: number
    }) {
        super(payload.message)
        this.message = payload.message
        this.code = payload.code
        this.statusCode = payload.statusCode ?? 400
        this.metadata = payload.metadata ?? {}
    }
}
