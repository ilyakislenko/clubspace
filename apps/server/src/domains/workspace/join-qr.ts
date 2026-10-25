import { toDataURL } from 'qrcode'

// PNG data URI of the QR code for a join link. Rendered here so the admin
// <img> and the mobile Image just show it — no QR library on the clients. In
// its own file so handler specs can mock it.
export const buildJoinQrPngDataUrl = (url: string): Promise<string> =>
    toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 1024 })
