import type { ErrorEvent } from '@sentry/node'

import {
    isSensitiveKey,
    scrubBreadcrumb,
    scrubEvent,
    scrubString,
    scrubValue,
} from './sentry-scrub'

const JWT =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJlLXZhbHVlLWhlcmU'

describe('scrubString', () => {
    it('masks e-mails, phones, JWTs and bearer credentials', () => {
        expect(
            scrubString(
                `user Ivan.Petrov+club@mail.ru called +7 (999) 123-45-67 with ${JWT}`,
            ),
        ).toBe('user [email] called [phone] with [token]')
        expect(scrubString('Authorization: Bearer abc.def-ghi')).toBe(
            'Authorization: Bearer [token]',
        )
        expect(scrubString('phone 89991234567')).toBe('phone [phone]')
    })

    it('leaves ids, dates and short numbers alone', () => {
        const text =
            'workspace 6f1c2d3e-0000-4000-8000-000000000000 on 2026-11-01, 404 after 15 min'
        expect(scrubString(text)).toBe(text)
    })
})

describe('isSensitiveKey', () => {
    it.each([
        'password',
        'refreshToken',
        'access_token',
        'Authorization',
        'cookie',
        'set-cookie',
        'code',
        'email',
        'contactEmail',
        'phone',
        'x-api-secret',
    ])('flags %s', (key) => expect(isSensitiveKey(key)).toBe(true))

    it.each(['statusCode', 'author', 'workspaceId', 'method', 'route'])(
        'keeps %s',
        (key) => expect(isSensitiveKey(key)).toBe(false),
    )
})

describe('scrubValue', () => {
    it('filters sensitive keys and masks nested strings', () => {
        expect(
            scrubValue({
                refreshToken: 'x',
                nested: { note: 'write to a@b.co', list: ['+79991234567'] },
                count: 3,
            }),
        ).toEqual({
            refreshToken: '[filtered]',
            nested: { note: 'write to [email]', list: ['[phone]'] },
            count: 3,
        })
    })

    it('stops at a depth limit', () => {
        let deep: Record<string, unknown> = { leaf: 1 }
        for (let i = 0; i < 12; i++) deep = { child: deep }
        expect(JSON.stringify(scrubValue(deep))).toContain('[truncated]')
    })
})

describe('scrubEvent', () => {
    it('drops the request body, headers, cookies and query, keeps url path and method', () => {
        const event = scrubEvent({
            type: undefined,
            request: {
                url: 'https://api.example/join?code=ABC&email=a@b.co',
                method: 'POST',
                data: { email: 'a@b.co', code: '123456' },
                headers: { authorization: `Bearer ${JWT}` },
                cookies: { sid: 'x' },
                query_string: 'code=ABC',
            },
        } as ErrorEvent)
        expect(event.request).toEqual({
            url: 'https://api.example/join',
            method: 'POST',
        })
    })

    it('reduces the user to an id and masks messages, exceptions, extra, contexts and tags', () => {
        const event = scrubEvent({
            type: undefined,
            user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
            message: 'failed for a@b.co',
            exception: {
                values: [{ type: 'Error', value: 'no user a@b.co' }],
            },
            extra: { body: { phone: '+79991234567' }, note: 'a@b.co' },
            contexts: { info: { token: 't', who: 'a@b.co' } },
            tags: { email: 'a@b.co', route: '/me' },
            breadcrumbs: [{ message: 'sent to a@b.co' }],
        } as ErrorEvent)
        expect(event.user).toEqual({ id: 'u1' })
        expect(event.message).toBe('failed for [email]')
        expect(event.exception?.values?.[0].value).toBe('no user [email]')
        expect(event.extra).toEqual({
            body: { phone: '[filtered]' },
            note: '[email]',
        })
        expect(event.contexts).toEqual({
            info: { token: '[filtered]', who: '[email]' },
        })
        expect(event.tags).toEqual({ email: '[filtered]', route: '/me' })
        expect(event.breadcrumbs?.[0].message).toBe('sent to [email]')
    })

    it('drops a user without an id entirely', () => {
        const event = scrubEvent({
            type: undefined,
            user: { email: 'a@b.co' },
        } as ErrorEvent)
        expect(event.user).toEqual({})
    })
})

describe('scrubBreadcrumb', () => {
    it('strips query strings from http breadcrumbs and masks data', () => {
        expect(
            scrubBreadcrumb({
                category: 'http',
                data: {
                    url: 'https://api.example/x?token=abc',
                    method: 'GET',
                    status_code: 200,
                    email: 'a@b.co',
                },
            }),
        ).toEqual({
            category: 'http',
            data: {
                url: 'https://api.example/x',
                method: 'GET',
                status_code: 200,
                email: '[filtered]',
            },
        })
    })

    it('passes a breadcrumb without data or message through', () => {
        expect(scrubBreadcrumb({ category: 'navigation' })).toEqual({
            category: 'navigation',
        })
    })
})
