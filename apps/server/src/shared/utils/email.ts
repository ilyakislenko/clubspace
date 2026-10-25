import { z } from 'zod'

// One account per address regardless of letter case: every e-mail INPUT goes
// through this so `Ivan@Mail.ru` and `ivan@mail.ru` are the same person.
export const emailSchema = z.string().trim().toLowerCase().email().max(255)
