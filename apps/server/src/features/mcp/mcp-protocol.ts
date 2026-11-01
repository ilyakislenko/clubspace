// JSON-RPC 2.0 framing of the Model Context Protocol, Streamable HTTP transport
// (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
// Pure: the controller feeds it the parsed body and writes back what it
// returns. Stateless server: no Mcp-Session-Id, no server-initiated stream.

// Newest first; `initialize` answers with the client's version when we speak
// it, else with the newest one (the client then decides whether to go on).
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const MCP_LATEST_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0]

export const JSONRPC = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    // Implementation-defined server errors (-32000..-32099).
    UNAUTHORIZED: -32001,
    FORBIDDEN: -32003,
    RATE_LIMITED: -32029,
} as const

export type JsonRpcId = string | number

export type JsonRpcError = {
    jsonrpc: '2.0'
    id: JsonRpcId | null
    error: { code: number; message: string; data?: unknown }
}

export type JsonRpcSuccess = {
    jsonrpc: '2.0'
    id: JsonRpcId
    result: unknown
}

export type McpMessage =
    | {
          kind: 'request'
          id: JsonRpcId
          method: string
          params: Record<string, unknown>
      }
    | { kind: 'notification'; method: string }
    // A client's reply to a server request. We never send any, so it's
    // acknowledged and dropped.
    | { kind: 'response' }
    | { kind: 'invalid'; error: JsonRpcError }

export const rpcError = (
    id: JsonRpcId | null,
    code: number,
    message: string,
    data?: unknown,
): JsonRpcError => ({
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
})

export const rpcResult = (id: JsonRpcId, result: unknown): JsonRpcSuccess => ({
    jsonrpc: '2.0',
    id,
    result,
})

const isId = (v: unknown): v is JsonRpcId =>
    (typeof v === 'string' && v.length > 0 && v.length <= 200) ||
    (typeof v === 'number' && Number.isFinite(v))

const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

// Classifies one POSTed body. Batches were removed from MCP in 2025-06-18.
export const parseMcpMessage = (body: unknown): McpMessage => {
    if (Array.isArray(body)) {
        return {
            kind: 'invalid',
            error: rpcError(
                null,
                JSONRPC.INVALID_REQUEST,
                'Пакетные запросы (JSON-RPC batch) не поддерживаются: отправляйте по одному сообщению',
            ),
        }
    }
    if (!isObject(body) || body.jsonrpc !== '2.0') {
        return {
            kind: 'invalid',
            error: rpcError(
                null,
                JSONRPC.INVALID_REQUEST,
                'Ожидается сообщение JSON-RPC 2.0',
            ),
        }
    }
    const hasId = 'id' in body && body.id !== undefined
    if (typeof body.method !== 'string' || body.method.length === 0) {
        if (hasId && ('result' in body || 'error' in body)) {
            return { kind: 'response' }
        }
        return {
            kind: 'invalid',
            error: rpcError(
                hasId && isId(body.id) ? body.id : null,
                JSONRPC.INVALID_REQUEST,
                'Не указан метод',
            ),
        }
    }
    if (!hasId) return { kind: 'notification', method: body.method }
    if (!isId(body.id)) {
        return {
            kind: 'invalid',
            error: rpcError(null, JSONRPC.INVALID_REQUEST, 'Некорректный id запроса'),
        }
    }
    if (body.params !== undefined && !isObject(body.params)) {
        return {
            kind: 'invalid',
            error: rpcError(body.id, JSONRPC.INVALID_PARAMS, 'params должен быть объектом'),
        }
    }
    return {
        kind: 'request',
        id: body.id,
        method: body.method,
        params: (body.params as Record<string, unknown> | undefined) ?? {},
    }
}

export const negotiateProtocolVersion = (requested: unknown): string =>
    typeof requested === 'string' &&
    (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : MCP_LATEST_PROTOCOL_VERSION

// The MCP-Protocol-Version header on requests after initialize. Absent = the
// client predates the header (2025-03-26): accepted.
export const isSupportedProtocolHeader = (header: string | undefined): boolean =>
    header === undefined ||
    header === '' ||
    (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(header)
