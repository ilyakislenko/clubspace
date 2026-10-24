// environment.ts reads required env vars at import; stub it so loading the
// interceptor under test doesn't need the full CI env.
jest.mock('../../environments/environment', () => ({
    environment: { production: false },
}))

import { ExecutionContext, HttpException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client'
import { ZodValidationException } from 'nestjs-zod'
import { lastValueFrom, throwError } from 'rxjs'
import { z } from 'zod'
import { LoggingInterceptor } from './logging.interceptor'

z.config(z.locales.ru())

const run = async (exception: unknown) => {
    const response = { getHeader: jest.fn(), setHeader: jest.fn() }
    const context = {
        switchToHttp: () => ({
            getRequest: () => ({ body: {}, params: {}, query: {}, headers: {} }),
            getResponse: () => response,
        }),
    } as unknown as ExecutionContext
    const interceptor = new LoggingInterceptor({ decode: jest.fn() } as never)

    try {
        await lastValueFrom(
            interceptor.intercept(context, {
                handle: () => throwError(() => exception),
            }),
        )
    } catch (e) {
        return e as HttpException
    }
    throw new Error('expected the interceptor to rethrow')
}

describe('LoggingInterceptor error mapping', () => {
    it('turns a zod issue into a Russian message prefixed with its field path', async () => {
        const result = z.object({ price: z.number().gt(0) }).safeParse({
            price: 0,
        })
        if (result.success) throw new Error('expected a validation failure')

        const err = await run(new ZodValidationException(result.error))

        expect(err.getStatus()).toBe(400)
        expect(err.getResponse()).toMatchObject({
            statusCode: 400,
            message: expect.stringMatching(
                /^price: Слишком маленькое значение/,
            ),
        })
    })

    it('leaves a path-less zod issue unprefixed', async () => {
        const result = z.number().gt(0).safeParse(0)
        if (result.success) throw new Error('expected a validation failure')

        const err = await run(new ZodValidationException(result.error))

        expect(err.getResponse()).toMatchObject({
            message: expect.stringMatching(/^Слишком маленькое значение/),
        })
    })

    it('maps a Prisma P2002 unique violation to a 409', async () => {
        const prismaErr = new PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'test',
        })

        const err = await run(prismaErr)

        expect(err.getStatus()).toBe(409)
        expect(err.getResponse()).toMatchObject({
            statusCode: 409,
            code: 'CONFLICT',
            message: 'Такая запись уже существует',
        })
    })
})
