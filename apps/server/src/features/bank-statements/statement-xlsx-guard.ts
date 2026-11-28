import { inflateRawSync } from 'zlib'

import { BadRequestError } from '../../shared/errors/shared.errors'

// An .xlsx is a zip; 5 МБ of it can inflate to gigabytes (a «zip bomb»), and
// read-excel-file streams local headers and keeps every inflated entry in
// memory. So the uploaded archive never reaches it: every entry listed in the
// central directory is inflated here with a hard output cap (its declared
// size, the declared total ≤ 50 МБ), and the library gets a rebuilt archive of
// those bytes stored uncompressed with exact sizes — nothing in it can inflate
// further, and nothing the directory doesn't list survives.

export const XLSX_MAX_UNZIPPED_BYTES = 50 * 1024 * 1024
export const XLSX_MAX_ENTRIES = 500

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const ZIP64_EXTRA = 0x0001
const U32_MAX = 0xffffffff

const TOO_BIG = `Excel-файл слишком большой после распаковки (больше ${XLSX_MAX_UNZIPPED_BYTES / 1024 / 1024} МБ) — выгрузите выписку за период короче или в CSV`
export const XLSX_BROKEN = 'Не удалось прочитать Excel-файл — сохраните выписку заново как .xlsx или CSV'

const broken = (): never => {
    throw new BadRequestError({ message: XLSX_BROKEN })
}
const tooBig = (): never => {
    throw new BadRequestError({ message: TOO_BIG })
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
})
const crc32 = (data: Uint8Array): number => {
    let c = 0xffffffff
    for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

type Entry = { name: Uint8Array; data: Uint8Array }

// The archive's entries, each inflated under its declared size.
const readEntries = (bytes: Uint8Array): Entry[] => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const u16 = (at: number) => (at >= 0 && at + 2 <= bytes.length ? view.getUint16(at, true) : -1)
    const u32 = (at: number) => (at >= 0 && at + 4 <= bytes.length ? view.getUint32(at, true) : -1)
    const u64 = (at: number) => (at >= 0 && at + 8 <= bytes.length ? Number(view.getBigUint64(at, true)) : -1)

    let eocd = -1
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
        if (u32(at) === EOCD) {
            eocd = at
            break
        }
    }
    if (eocd === -1) broken()
    const count = u16(eocd + 10)
    const cdOffset = u32(eocd + 16)
    // A ZIP64 end record: never needed by a statement-sized workbook.
    if (count === 0xffff || cdOffset === U32_MAX) broken()
    if (count > XLSX_MAX_ENTRIES) tooBig()

    const entries: Entry[] = []
    let total = 0
    let at = cdOffset
    for (let i = 0; i < count; i++) {
        if (u32(at) !== CENTRAL) broken()
        const flags = u16(at + 8)
        const method = u16(at + 10)
        let compressed = u32(at + 20)
        let size = u32(at + 24)
        const nameLen = u16(at + 28)
        const extraLen = u16(at + 30)
        const commentLen = u16(at + 32)
        let localAt = u32(at + 42)
        // ZIP64 sizes live in the extra field, in this order, for each
        // 32-bit value set to 0xFFFFFFFF.
        if (size === U32_MAX || compressed === U32_MAX || localAt === U32_MAX) {
            let x = at + 46 + nameLen
            const end = x + extraLen
            let found = false
            while (x + 4 <= end) {
                const id = u16(x)
                const len = u16(x + 2)
                if (id === ZIP64_EXTRA) {
                    let p = x + 4
                    if (size === U32_MAX) {
                        size = u64(p)
                        p += 8
                    }
                    if (compressed === U32_MAX) {
                        compressed = u64(p)
                        p += 8
                    }
                    if (localAt === U32_MAX) {
                        localAt = u64(p)
                        p += 8
                    }
                    found = p <= x + 4 + len
                    break
                }
                x += 4 + len
            }
            if (!found || size < 0 || compressed < 0 || localAt < 0) broken()
        }
        total += size
        if (total > XLSX_MAX_UNZIPPED_BYTES) tooBig()
        if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) broken()

        // The local header must describe the same entry the directory does.
        if (u32(localAt) !== LOCAL || u16(localAt + 6) !== flags || u16(localAt + 8) !== method) broken()
        const localCompressed = u32(localAt + 18)
        const localSize = u32(localAt + 22)
        const hasDescriptor = (flags & 8) !== 0
        const zip64Local = localCompressed === U32_MAX && localSize === U32_MAX
        const sizesAgree = zip64Local || (localCompressed === compressed && localSize === size)
        if (hasDescriptor ? !(sizesAgree || (localCompressed === 0 && localSize === 0)) : !sizesAgree) broken()
        const dataAt = localAt + 30 + u16(localAt + 26) + u16(localAt + 28)
        const data = bytes.subarray(dataAt, dataAt + compressed)
        if (data.length !== compressed) broken()

        let content: Uint8Array
        if (method === 0) {
            if (compressed !== size) broken()
            content = data
        } else {
            try {
                // Throws as soon as the real output passes what the entry claims.
                content = inflateRawSync(data, { maxOutputLength: Math.max(1, size) })
            } catch (e) {
                if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') tooBig()
                return broken()
            }
            if (content.length !== size) broken()
        }
        entries.push({ name: bytes.subarray(at + 46, at + 46 + nameLen), data: content })
        at += 46 + nameLen + extraLen + commentLen
    }
    return entries
}

// The checked entries as a plain archive: stored, exact sizes, no extras.
const storedZip = (entries: Entry[]): Buffer => {
    const parts: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const e of entries) {
        const crc = crc32(e.data)
        const local = Buffer.alloc(30)
        local.writeUInt32LE(LOCAL, 0)
        local.writeUInt16LE(20, 4)
        local.writeUInt32LE(crc, 14)
        local.writeUInt32LE(e.data.length, 18)
        local.writeUInt32LE(e.data.length, 22)
        local.writeUInt16LE(e.name.length, 26)
        const dir = Buffer.alloc(46)
        dir.writeUInt32LE(CENTRAL, 0)
        dir.writeUInt16LE(20, 4)
        dir.writeUInt16LE(20, 6)
        dir.writeUInt32LE(crc, 16)
        dir.writeUInt32LE(e.data.length, 20)
        dir.writeUInt32LE(e.data.length, 24)
        dir.writeUInt16LE(e.name.length, 28)
        dir.writeUInt32LE(offset, 42)
        parts.push(local, Buffer.from(e.name), Buffer.from(e.data))
        central.push(dir, Buffer.from(e.name))
        offset += 30 + e.name.length + e.data.length
    }
    const cd = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(EOCD, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(cd.length, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...parts, cd, end])
}

// The uploaded workbook → an archive safe to hand to read-excel-file.
export const rebuildXlsxSafely = (bytes: Uint8Array): Buffer => storedZip(readEntries(bytes))
