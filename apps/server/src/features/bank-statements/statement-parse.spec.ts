import { readFileSync } from 'fs'
import { join } from 'path'
import { deflateRawSync } from 'zlib'

import { BadRequestError } from '../../shared/errors/shared.errors'
import { fingerprintTransactions, parseStatement, UNKNOWN_FORMAT_MESSAGE } from './statement-parse'
import { rebuildXlsxSafely, XLSX_BROKEN } from './statement-xlsx-guard'

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)))

describe('parseStatement — 1CClientBankExchange', () => {
    it('reads the credits of a Windows-1251 file and skips the club’s own payments', async () => {
        const res = await parseStatement(fixture('1c-statement-1251.txt'), null)
        expect(res.format).toBe('ONE_C')
        expect(res.table).toBeNull()
        // Rent paid from the club's account is outgoing.
        expect(res.skippedDebits).toBe(1)
        expect(res.transactions).toEqual([
            {
                date: '2026-11-03',
                time: null,
                amountMinor: 450000,
                currency: 'RUB',
                // ИНН is cut off the payer.
                payer: 'ПЕТРОВА ЕЛЕНА СЕРГЕЕВНА',
                purpose: 'Оплата абонемента за Петрова Михаила, ноябрь. НДС не облагается',
                docNumber: '512',
            },
            expect.objectContaining({ date: '2026-11-05', amountMinor: 300000, payer: 'ИВАНОВ ИВАН ИВАНОВИЧ', docNumber: '88231' }),
            expect.objectContaining({ date: '2026-11-12', amountMinor: 250000, payer: 'СИДОРОВА А.В.' }),
            expect.objectContaining({ date: '2026-11-20', amountMinor: 1200000, payer: 'ООО «РОМАШКА»' }),
        ])
    })

    it('reads a UTF-8 file without account lines by its credit dates', async () => {
        const res = await parseStatement(fixture('1c-statement-utf8.txt'), null)
        expect(res.format).toBe('ONE_C')
        expect(res.transactions.map((t) => t.amountMinor)).toEqual([450000, 300000, 250000, 1200000])
        expect(res.skippedDebits).toBe(1)
    })

    it('reads a DOS-866 file and joins a purpose split over several lines', async () => {
        const text = [
            '1CClientBankExchange',
            'Кодировка=DOS',
            'РасчСчет=40702810900000012345',
            'СекцияДокумент=Платежное поручение',
            'Номер=7',
            'Дата=01.12.2026',
            'Сумма=1500',
            'Плательщик=Козлов Олег Петрович',
            'ПлательщикСчет=40817810000000000007',
            'ПолучательСчет=40702810900000012345',
            'НазначениеПлатежа1=Абонемент',
            'НазначениеПлатежа2=декабрь',
            'КонецДокумента',
            'КонецФайла',
        ].join('\r\n')
        // Node can decode 866 but not encode it: build the bytes by hand.
        const cp866 = (s: string) =>
            new Uint8Array(
                [...s].map((ch) => {
                    const c = ch.codePointAt(0) as number
                    if (c < 0x80) return c
                    if (c >= 0x410 && c <= 0x43f) return c - 0x410 + 0x80
                    if (c >= 0x440 && c <= 0x44f) return c - 0x440 + 0xe0
                    if (c === 0x401) return 0xf0
                    if (c === 0x451) return 0xf1
                    return 0x3f
                }),
            )
        const res = await parseStatement(cp866(text), null)
        expect(res.transactions).toEqual([
            expect.objectContaining({
                date: '2026-12-01',
                amountMinor: 150000,
                payer: 'Козлов Олег Петрович',
                purpose: 'Абонемент декабрь',
            }),
        ])
    })
})

describe('parseStatement — CSV and Excel', () => {
    it('reads a Т-Банк operations export: incoming, OK only, with the time', async () => {
        const res = await parseStatement(fixture('tbank-operations.csv'), null)
        expect(res.format).toBe('CSV')
        expect(res.table?.complete).toBe(true)
        expect(res.table?.columns).toMatchObject({ date: 0, amount: 4, payer: 11, purpose: null, currency: 5, status: 3 })
        expect(res.table?.headers[11]).toBe('Описание')
        // The card purchase and the failed transfer.
        expect(res.skippedDebits).toBe(2)
        expect(res.transactions).toEqual([
            {
                date: '2026-11-28',
                time: '14:03',
                amountMinor: 300000,
                currency: 'RUB',
                payer: 'Иван И.',
                purpose: '',
                docNumber: null,
            },
            expect.objectContaining({ date: '2026-11-25', time: '08:30', payer: 'Анна С.' }),
            expect.objectContaining({ date: '2026-11-25', time: '08:31', payer: 'Анна С.' }),
        ])
    })

    it('finds the header under a title block and reads a credit column (Сбер-style)', async () => {
        const res = await parseStatement(fixture('sber-operations.csv'), null)
        expect(res.table?.columns).toMatchObject({ date: 0, amount: 1, payer: 3, purpose: 4 })
        expect(res.skippedDebits).toBe(1)
        expect(res.transactions).toEqual([
            expect.objectContaining({
                date: '2026-11-02',
                amountMinor: 450000,
                payer: 'Петрова Елена Сергеевна',
                purpose: 'Абонемент Миша Петров ноябрь',
            }),
            expect.objectContaining({ date: '2026-11-30', amountMinor: 300000, payer: 'Смирнов Пётр' }),
        ])
    })

    it('reads an Excel export, dates included', async () => {
        const res = await parseStatement(fixture('tbank-operations.xlsx'), null)
        expect(res.format).toBe('XLSX')
        expect(res.skippedDebits).toBe(1)
        expect(res.transactions).toEqual([
            expect.objectContaining({ date: '2026-11-28', time: '14:03', amountMinor: 300000, payer: 'Иван И.' }),
            expect.objectContaining({ date: '2026-11-25', time: null, amountMinor: 250000, payer: 'Анна С.' }),
        ])
    })

    it('asks for the columns when the headers are not recognised, then reads with them', async () => {
        const first = await parseStatement(fixture('unknown-columns.csv'), null)
        expect(first.transactions).toEqual([])
        expect(first.table).toMatchObject({
            complete: false,
            headers: ['Когда', 'Сколько', 'Кто', 'Зачем'],
            sample: [
                ['28.11.2026', '3000', 'Иван И.', 'абонемент'],
                ['29.11.2026', '2500', 'Анна С.', ''],
            ],
        })
        const second = await parseStatement(fixture('unknown-columns.csv'), {
            date: 0,
            amount: 1,
            payer: 2,
            purpose: 3,
        })
        expect(second.table?.complete).toBe(true)
        expect(second.transactions).toEqual([
            expect.objectContaining({ date: '2026-11-28', amountMinor: 300000, payer: 'Иван И.', purpose: 'абонемент' }),
            expect.objectContaining({ date: '2026-11-29', amountMinor: 250000, payer: 'Анна С.' }),
        ])
    })
})

describe('parseStatement — refusals', () => {
    it.each([
        ['an empty file', new Uint8Array(), 'Файл пустой'],
        ['a PDF', new Uint8Array(Buffer.from('%PDF-1.7 …')), 'PDF-выписку прочитать нельзя'],
        ['an old .xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]), 'Старый формат Excel'],
        ['a broken .xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'Не удалось прочитать Excel-файл'],
        ['plain text', new Uint8Array(Buffer.from('просто заметка\nещё строка')), UNKNOWN_FORMAT_MESSAGE],
        ['a too-big file', new Uint8Array(6 * 1024 * 1024), 'Файл больше 5 МБ'],
    ])('refuses %s with a clear message', async (_, bytes, message) => {
        const err = await parseStatement(bytes, null).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(BadRequestError)
        expect((err as Error).message).toContain(message)
    })
})

// A minimal zip writer for crafted archives: entries back to back, then the
// central directory. `claim` overrides the uncompressed size the directory
// declares; `localMethod` lets the local header disagree with the directory
// (the data is written the local way, as a streaming reader would read it);
// `descriptor` sets flag 8 with zero local sizes and a trailing descriptor;
// `zip64` writes 0xFFFFFFFF sizes with the real ones in the zip64 extra field.
type ZipEntry = {
    name: string
    data: Buffer
    claim?: number
    listed?: boolean
    method?: 0 | 8
    localMethod?: 0 | 8
    descriptor?: boolean
    zip64?: boolean
}
const zipOf = (entries: ZipEntry[]): Uint8Array => {
    const locals: Buffer[] = []
    const centrals: Buffer[] = []
    let offset = 0
    let listed = 0
    for (const e of entries) {
        const method = e.method ?? 8
        const localMethod = e.localMethod ?? method
        const packed = localMethod === 8 ? deflateRawSync(e.data) : e.data
        const name = Buffer.from(e.name)
        const size = e.claim ?? e.data.length
        const flags = e.descriptor ? 8 : 0
        const extra = Buffer.alloc(e.zip64 ? 20 : 0)
        if (e.zip64) {
            extra.writeUInt16LE(1, 0)
            extra.writeUInt16LE(16, 2)
            extra.writeBigUInt64LE(BigInt(size), 4)
            extra.writeBigUInt64LE(BigInt(packed.length), 12)
        }
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(flags, 6)
        local.writeUInt16LE(localMethod, 8)
        local.writeUInt32LE(e.descriptor ? 0 : e.zip64 ? 0xffffffff : packed.length, 18)
        local.writeUInt32LE(e.descriptor ? 0 : e.zip64 ? 0xffffffff : size, 22)
        local.writeUInt16LE(name.length, 26)
        if (e.listed !== false) {
            const central = Buffer.alloc(46)
            central.writeUInt32LE(0x02014b50, 0)
            central.writeUInt16LE(flags, 8)
            central.writeUInt16LE(method, 10)
            central.writeUInt32LE(e.zip64 ? 0xffffffff : packed.length, 20)
            central.writeUInt32LE(e.zip64 ? 0xffffffff : size, 24)
            central.writeUInt16LE(name.length, 28)
            central.writeUInt16LE(extra.length, 30)
            central.writeUInt32LE(offset, 42)
            centrals.push(central, name, extra)
            listed++
        }
        const descriptor = Buffer.alloc(e.descriptor ? 16 : 0)
        if (e.descriptor) {
            descriptor.writeUInt32LE(0x08074b50, 0)
            descriptor.writeUInt32LE(packed.length, 8)
            descriptor.writeUInt32LE(size, 12)
        }
        locals.push(local, name, packed, descriptor)
        offset += 30 + name.length + packed.length + descriptor.length
    }
    const cd = Buffer.concat(centrals)
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(listed, 8)
    eocd.writeUInt16LE(listed, 10)
    eocd.writeUInt32LE(cd.length, 12)
    eocd.writeUInt32LE(offset, 16)
    return new Uint8Array(Buffer.concat([...locals, cd, eocd]))
}

const refusal = async (bytes: Uint8Array) => {
    const err = await parseStatement(bytes, null).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BadRequestError)
    return (err as Error).message
}

const guardRefusal = (bytes: Uint8Array) => {
    try {
        rebuildXlsxSafely(bytes)
    } catch (e) {
        expect(e).toBeInstanceOf(BadRequestError)
        return (e as Error).message
    }
    throw new Error('the guard let it through')
}

describe('parseStatement — Excel archive guard', () => {
    const sheet = { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet/>') }
    const huge = Buffer.alloc(60 * 1024 * 1024)

    it('refuses an archive that declares more than 50 МБ unpacked', async () => {
        const bomb = zipOf([sheet, { name: 'xl/sharedStrings.xml', data: huge }])
        expect(bomb.length).toBeLessThan(200 * 1024)
        expect(await refusal(bomb)).toContain('слишком большой после распаковки')
    })

    it('refuses an entry that inflates past what it declares', async () => {
        const liar = zipOf([{ name: 'xl/sharedStrings.xml', data: huge, claim: 1000 }])
        expect(await refusal(liar)).toContain('слишком большой после распаковки')
    })

    it('refuses a local header that disagrees with the directory (stored there, deflate here)', () => {
        const mismatch = zipOf([
            { name: 'xl/workbook.xml', data: huge, method: 0, localMethod: 8, descriptor: true, claim: 300_000 },
        ])
        expect(guardRefusal(mismatch)).toBe(XLSX_BROKEN)
    })

    // The library only ever sees the rebuilt archive, so bytes that look like a
    // descriptor signature inside entry data are harmless and must not refuse.
    it('accepts a descriptor entry whose data happens to contain a descriptor signature', () => {
        const body = Buffer.concat([Buffer.from('<x>'), Buffer.from([0x50, 0x4b, 0x07, 0x08]), Buffer.from('</x>')])
        const rebuilt = rebuildXlsxSafely(zipOf([{ name: 'xl/workbook.xml', data: body, method: 0, descriptor: true }]))
        expect(rebuilt.includes(body)).toBe(true)
    })

    it('reads ZIP64 sizes from the extra field', () => {
        const rebuilt = rebuildXlsxSafely(zipOf([{ ...sheet, zip64: true }]))
        expect(rebuilt.includes('<worksheet/>')).toBe(true)
    })

    it('hands the library only the listed entries, stored with exact sizes', async () => {
        const rebuilt = rebuildXlsxSafely(zipOf([{ ...sheet, name: 'x.xml', listed: false }, sheet]))
        expect(rebuilt.includes('x.xml')).toBe(false)
        expect(rebuilt.includes('<worksheet/>')).toBe(true)
        // The real export still reads after the rebuild.
        const res = await parseStatement(fixture('tbank-operations.xlsx'), null)
        expect(res.transactions).toHaveLength(2)
    })

    it('refuses too many entries', async () => {
        const crowd = zipOf(Array.from({ length: 501 }, (_, i) => ({ name: `f${i}.xml`, data: Buffer.from('x') })))
        expect(await refusal(crowd)).toContain('слишком большой после распаковки')
    })
})

describe('parseStatement — table shape and direction', () => {
    const csv = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'))

    it('refuses a file wider than 200 columns', async () => {
        const wide = csv(`Дата;Сумма;${'x;'.repeat(250)}\n01.11.2026;100;\n`)
        expect(await refusal(wide)).toBe('В файле больше 200 колонок — это не похоже на выписку операций')
    })

    it('reads incoming rows by a direction column next to an unsigned amount', async () => {
        const res = await parseStatement(
            csv(
                [
                    'Дата;Сумма;Тип операции;Контрагент',
                    '01.11.2026;3000;Поступление;Иванов Иван',
                    '02.11.2026;3000;Списание;Иванов Иван',
                    '03.11.2026;1500;Кредит;Петрова Анна',
                ].join('\n'),
            ),
            null,
        )
        expect(res.directionKnown).toBe(true)
        expect(res.skippedDebits).toBe(1)
        expect(res.transactions.map((t) => [t.date, t.payer])).toEqual([
            ['2026-11-01', 'Иванов Иван'],
            ['2026-11-03', 'Петрова Анна'],
        ])
    })

    it('falls back to the amount sign for a direction cell it can’t read («Перевод СБП»)', async () => {
        const res = await parseStatement(
            csv(
                [
                    'Дата;Сумма;Тип операции;Плательщик',
                    '01.11.2026;3000;Перевод СБП;Иванов Иван',
                    '02.11.2026;-500;Оплата услуг;ООО Связь',
                ].join('\n'),
            ),
            null,
        )
        expect(res.transactions.map((t) => t.payer)).toEqual(['Иванов Иван'])
        // The negative row tells the direction, not the column.
        expect(res.directionKnown).toBe(true)
        const unread = await parseStatement(
            csv('Дата;Сумма;Тип операции;Плательщик\n01.11.2026;3000;Перевод СБП;Иванов Иван\n'),
            null,
        )
        expect(unread.transactions).toHaveLength(1)
        // Nothing in the column read as a side: unknown, nothing pre-selected.
        expect(unread.directionKnown).toBe(false)
    })

    it('says the direction is unknown for an unsigned amount without one', async () => {
        const res = await parseStatement(csv('Дата;Сумма;Плательщик\n01.11.2026;3000;Иванов Иван\n'), null)
        expect(res.transactions).toHaveLength(1)
        expect(res.directionKnown).toBe(false)
    })

    it('knows the direction from negative amounts or a credit-only column', async () => {
        expect((await parseStatement(fixture('tbank-operations.csv'), null)).directionKnown).toBe(true)
        expect((await parseStatement(fixture('sber-operations.csv'), null)).directionKnown).toBe(true)
        expect((await parseStatement(fixture('1c-statement-1251.txt'), null)).directionKnown).toBe(true)
    })
})

describe('fingerprintTransactions', () => {
    const t = {
        date: '2026-11-25',
        time: '08:30',
        amountMinor: 250000,
        currency: 'RUB',
        payer: 'Анна С.',
        purpose: '',
        docNumber: null,
    }

    it('is stable for the same statement and ignores case and ё in the payer', () => {
        const a = fingerprintTransactions('w1', [t])
        const b = fingerprintTransactions('w1', [{ ...t, payer: 'АННА  С' }])
        expect(a).toEqual(b)
        expect(a[0]).toMatch(/^[0-9a-f]{64}$/)
    })

    it('keeps two identical lines apart and differs per club', () => {
        const [first, second] = fingerprintTransactions('w1', [t, t])
        expect(first).not.toBe(second)
        expect(fingerprintTransactions('w2', [t])[0]).not.toBe(first)
        // The n-th identical line keeps its value on a re-upload.
        expect(fingerprintTransactions('w1', [t, t])).toEqual([first, second])
    })

    it('differs by date, amount and document number', () => {
        const [base] = fingerprintTransactions('w1', [t])
        expect(fingerprintTransactions('w1', [{ ...t, amountMinor: 250001 }])[0]).not.toBe(base)
        expect(fingerprintTransactions('w1', [{ ...t, time: null }])[0]).not.toBe(base)
        expect(fingerprintTransactions('w1', [{ ...t, docNumber: '7' }])[0]).not.toBe(base)
    })
})
