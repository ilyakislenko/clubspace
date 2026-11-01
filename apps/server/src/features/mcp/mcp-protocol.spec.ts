import {
    isSupportedProtocolHeader,
    JSONRPC,
    MCP_LATEST_PROTOCOL_VERSION,
    negotiateProtocolVersion,
    parseMcpMessage,
} from './mcp-protocol'

describe('parseMcpMessage', () => {
    it('reads a request with and without params', () => {
        expect(parseMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toEqual({
            kind: 'request',
            id: 1,
            method: 'tools/list',
            params: {},
        })
        expect(
            parseMcpMessage({ jsonrpc: '2.0', id: 'a', method: 'tools/call', params: { name: 'x' } }),
        ).toMatchObject({ kind: 'request', id: 'a', params: { name: 'x' } })
    })

    it('tells notifications and client replies apart from requests', () => {
        expect(parseMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({
            kind: 'notification',
            method: 'notifications/initialized',
        })
        expect(parseMcpMessage({ jsonrpc: '2.0', id: 5, result: {} })).toEqual({ kind: 'response' })
        expect(parseMcpMessage({ jsonrpc: '2.0', id: 5, error: { code: 1 } })).toEqual({ kind: 'response' })
    })

    it.each([
        ['a batch', [{ jsonrpc: '2.0', id: 1, method: 'ping' }], JSONRPC.INVALID_REQUEST, null],
        ['not JSON-RPC 2.0', { id: 1, method: 'ping' }, JSONRPC.INVALID_REQUEST, null],
        ['a string', 'ping', JSONRPC.INVALID_REQUEST, null],
        ['no method', { jsonrpc: '2.0', id: 3 }, JSONRPC.INVALID_REQUEST, 3],
        ['an object id', { jsonrpc: '2.0', id: { x: 1 }, method: 'ping' }, JSONRPC.INVALID_REQUEST, null],
        ['array params', { jsonrpc: '2.0', id: 4, method: 'ping', params: [1] }, JSONRPC.INVALID_PARAMS, 4],
    ])('refuses %s', (_label, body, code, id) => {
        const parsed = parseMcpMessage(body)
        expect(parsed.kind).toBe('invalid')
        if (parsed.kind !== 'invalid') return
        expect(parsed.error).toMatchObject({ jsonrpc: '2.0', id, error: { code } })
    })
})

describe('protocol versions', () => {
    it('echoes a version we speak, else offers the newest', () => {
        expect(negotiateProtocolVersion('2025-06-18')).toBe('2025-06-18')
        expect(negotiateProtocolVersion('2025-03-26')).toBe('2025-03-26')
        expect(negotiateProtocolVersion('2024-11-05')).toBe(MCP_LATEST_PROTOCOL_VERSION)
        expect(negotiateProtocolVersion(undefined)).toBe(MCP_LATEST_PROTOCOL_VERSION)
    })

    it('accepts a missing header and refuses an unknown one', () => {
        expect(isSupportedProtocolHeader(undefined)).toBe(true)
        expect(isSupportedProtocolHeader('2025-06-18')).toBe(true)
        expect(isSupportedProtocolHeader('1999-01-01')).toBe(false)
    })
})
