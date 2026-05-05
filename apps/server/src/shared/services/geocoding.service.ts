import { HttpException, Injectable, Logger } from '@nestjs/common'

// Nominatim (OpenStreetMap) — free, no API key. Their usage policy
// requires a real User-Agent and asks not to exceed 1 req/sec. We
// gate ourselves to one in-flight call at a time and don't retry on
// transient failures: geocoding is best-effort, the gym still saves
// without coordinates if Nominatim is unreachable.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'bjj-academy/1.0 (https://github.com/ilyakislenko/bjj-academy)'

@Injectable()
export class GeocodingService {
    private readonly logger = new Logger(GeocodingService.name)
    private inFlight: Promise<unknown> = Promise.resolve()

    async geocode(address: string): Promise<{ lat: number; lng: number } | null> {
        if (!address.trim()) return null

        // Serialise calls — Nominatim's policy limits to ~1 req/sec.
        // For a club admin creating gyms one at a time this never matters,
        // but it protects bulk imports from getting our IP blocked.
        const release = this.inFlight
        let resolveNext: (value?: unknown) => void = () => undefined
        this.inFlight = new Promise((resolve) => {
            resolveNext = resolve
        })
        await release

        try {
            const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 6_000)
            try {
                const res = await fetch(url, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        Accept: 'application/json',
                    },
                    signal: controller.signal,
                })
                if (!res.ok) {
                    this.logger.warn(
                        `Nominatim returned ${res.status} for "${address}"`,
                    )
                    return null
                }
                const data = (await res.json()) as Array<{
                    lat?: string
                    lon?: string
                }>
                const first = data[0]
                if (!first?.lat || !first?.lon) return null
                const lat = Number.parseFloat(first.lat)
                const lng = Number.parseFloat(first.lon)
                if (Number.isNaN(lat) || Number.isNaN(lng)) return null
                return { lat, lng }
            } finally {
                clearTimeout(timeout)
            }
        } catch (err) {
            if (err instanceof HttpException) throw err
            this.logger.warn(
                `Geocoding failed for "${address}": ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
            return null
        } finally {
            resolveNext()
        }
    }
}
