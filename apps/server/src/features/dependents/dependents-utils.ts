import { z } from 'zod'

// Edition of the guardian consent text the app shows when a parent adds or
// confirms a child («Я родитель или законный представитель и даю согласие на
// обработку персональных данных ребёнка»). Stored on Guardianship with the
// timestamp; bump it when the text changes.
export const GUARDIAN_CONSENT_VERSION = '2026-11-01'

// Ceiling per guardian: a family, not a roster.
export const MAX_DEPENDENTS_PER_GUARDIAN = 10

export const dependentNameSchema = z.string().trim().min(1).max(100)

// YYYY-MM-DD, not in the future, not absurdly old.
export const dateOfBirthSchema = z.iso
    .date()
    .refine((d) => d >= '1900-01-01', {
        message: 'Проверьте дату рождения',
    })
    .refine((d) => d <= new Date().toISOString().slice(0, 10), {
        message: 'Дата рождения не может быть в будущем',
    })

// Stored as UTC midnight of that calendar day; read back with .slice(0, 10).
export const dateOfBirthToDate = (d: string): Date =>
    new Date(`${d}T00:00:00.000Z`)
