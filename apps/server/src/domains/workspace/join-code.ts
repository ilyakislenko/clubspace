import { randomBytes } from 'crypto'

// 31 characters: digits and letters minus the look-alikes 0/O, 1/I/L.
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const JOIN_CODE_LENGTH = 8

const JOIN_CODE_PATTERN = new RegExp(
    `^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`,
)

// Largest multiple of the alphabet size that fits in a byte (31 * 8). A byte at
// or above it is skipped, so every character is equally likely (no modulo bias).
const UNBIASED_LIMIT = 248

type RandomBytes = (size: number) => Buffer

export const generateJoinCode = (random: RandomBytes = randomBytes): string => {
    let code = ''
    while (code.length < JOIN_CODE_LENGTH) {
        for (const byte of random(JOIN_CODE_LENGTH * 2)) {
            if (byte >= UNBIASED_LIMIT) continue
            code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length]
            if (code.length === JOIN_CODE_LENGTH) break
        }
    }
    return code
}

// Cyrillic letters that look like Latin ones, so a Russian keyboard still
// types a code. Keep identical to apps/mobile/src/features/join/join-code.ts.
const CYRILLIC_LOOKALIKES: Record<string, string> = {
    А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H',
    О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y',
}

const latinize = (raw: string): string =>
    raw
        .toUpperCase()
        .replace(/[А-Я]/g, (ch) => CYRILLIC_LOOKALIKES[ch] ?? ch)

// Whatever a person typed or pasted → the stored form, or null when it can't
// be a code at all (callers treat null exactly like an unknown code).
export const normalizeJoinCode = (raw: string): string | null => {
    const code = latinize(raw).replace(/[\s-]/g, '')
    return JOIN_CODE_PATTERN.test(code) ? code : null
}

// ABCD2345 → ABCD-2345
export const formatJoinCode = (code: string): string =>
    `${code.slice(0, 4)}-${code.slice(4)}`
