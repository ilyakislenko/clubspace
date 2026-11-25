import { toDataURL } from 'qrcode'

// PNG data URI of a member card's QR. Rendered here so the admin <img> and the
// mobile Image just show it — no QR library on the clients. In its own file so
// handler specs can mock it (like domains/workspace/join-qr.ts).
export const buildCheckInCardPngDataUrl = (card: string): Promise<string> =>
    toDataURL(card, { errorCorrectionLevel: 'M', margin: 2, width: 768 })
