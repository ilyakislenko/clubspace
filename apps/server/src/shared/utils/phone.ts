// Phone numbers are stored in E.164-ish form («+79528849420») so they can be
// dialled and compared. Input is whatever a person types.
//
// A leading «+» keeps the digits as given; without it only a Russian number
// («8 952 …» / «7 952 …», 11 digits) can be recognised. Anything else is
// ambiguous, so it is refused rather than guessed. Also refused: «+8 9…» / «+8 3…»
// with 11 digits (a Russian «8 9xx…» / «8 3822…» typed with a stray plus would
// dial a wrong number; real +85x / +86x / +81 / +82 / +84 numbers pass), and
// anything but digits, spaces, brackets, dots and dashes — an extension
// («доб. 12», «вн.», «x12», «#», «,», «;») would otherwise be merged into the
// number and corrupt it.
export const normalizePhone = (raw: string): string | null => {
    const trimmed = raw.trim()
    if (!/^\+?[\d\s().\-]+$/.test(trimmed)) return null
    const digits = trimmed.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 15) return null
    if (trimmed.startsWith('+')) {
        return digits.length === 11 && /^8[39]/.test(digits) ? null : `+${digits}`
    }
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
        return `+7${digits.slice(1)}`
    }
    return null
}

// «+79528849420» → «+7 952 884-94-20»; any other shape is shown as stored.
export const formatPhone = (e164: string): string => {
    const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164)
    return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : e164
}
