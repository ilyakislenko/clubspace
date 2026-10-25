import { SendAuthCodeFeatureInputSchema } from '../../features/send-auth-code/send-auth-code.feature'
import { SignInFeatureInputSchema } from '../../features/sign-in/sign-in.feature'
import { emailSchema } from './email'

describe('emailSchema', () => {
    it('trims and lowercases', () => {
        expect(emailSchema.parse('  Ivan@Mail.RU ')).toBe('ivan@mail.ru')
    })

    it('still rejects a non-address', () => {
        expect(emailSchema.safeParse('not-an-email').success).toBe(false)
    })

    it('send-auth-code and sign-in normalise the same way', () => {
        expect(
            SendAuthCodeFeatureInputSchema.parse({ email: 'Ivan@Mail.ru' }).email,
        ).toBe('ivan@mail.ru')
        expect(
            SignInFeatureInputSchema.parse({ email: 'IVAN@mail.ru', code: '123456' })
                .email,
        ).toBe('ivan@mail.ru')
    })
})
