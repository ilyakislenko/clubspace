import { generateURI } from 'otplib'
import { toDataURL } from 'qrcode'

// What an authenticator app scans. In its own file so handler specs can mock
// it (otplib is ESM-only).
export const buildTotpEnrollment = async (p: {
    secret: string
    account: string
}): Promise<{ otpauthUrl: string; qrPngDataUrl: string }> => {
    const otpauthUrl = generateURI({
        issuer: 'ClubSpace',
        label: p.account,
        secret: p.secret,
    })
    const qrPngDataUrl = await toDataURL(otpauthUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512,
    })
    return { otpauthUrl, qrPngDataUrl }
}
