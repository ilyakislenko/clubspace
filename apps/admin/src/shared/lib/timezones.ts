// The zones a club picks from: cities of Russia and Kazakhstan by their
// Russian names, each mapped to its IANA zone. Several cities share a zone
// (Казань and Москва are both Europe/Moscow) so an owner finds their own city
// instead of having to know which IANA name covers it. The offset is computed
// by the runtime, so a tz-database change (Kazakhstan moved to UTC+5 in 2024)
// shows up without editing this list.

export type TimezoneCity = { city: string; zone: string }

export const TIMEZONE_CITIES: readonly TimezoneCity[] = [
  { city: "Калининград", zone: "Europe/Kaliningrad" },
  { city: "Москва", zone: "Europe/Moscow" },
  { city: "Санкт-Петербург", zone: "Europe/Moscow" },
  { city: "Казань", zone: "Europe/Moscow" },
  { city: "Нижний Новгород", zone: "Europe/Moscow" },
  { city: "Ростов-на-Дону", zone: "Europe/Moscow" },
  { city: "Краснодар", zone: "Europe/Moscow" },
  { city: "Сочи", zone: "Europe/Moscow" },
  { city: "Воронеж", zone: "Europe/Moscow" },
  { city: "Ярославль", zone: "Europe/Moscow" },
  { city: "Мурманск", zone: "Europe/Moscow" },
  { city: "Симферополь", zone: "Europe/Simferopol" },
  { city: "Волгоград", zone: "Europe/Volgograd" },
  { city: "Киров", zone: "Europe/Kirov" },
  { city: "Самара", zone: "Europe/Samara" },
  { city: "Ижевск", zone: "Europe/Samara" },
  { city: "Ульяновск", zone: "Europe/Ulyanovsk" },
  { city: "Саратов", zone: "Europe/Saratov" },
  { city: "Астрахань", zone: "Europe/Astrakhan" },
  { city: "Екатеринбург", zone: "Asia/Yekaterinburg" },
  { city: "Челябинск", zone: "Asia/Yekaterinburg" },
  { city: "Уфа", zone: "Asia/Yekaterinburg" },
  { city: "Пермь", zone: "Asia/Yekaterinburg" },
  { city: "Тюмень", zone: "Asia/Yekaterinburg" },
  { city: "Оренбург", zone: "Asia/Yekaterinburg" },
  { city: "Сургут", zone: "Asia/Yekaterinburg" },
  { city: "Омск", zone: "Asia/Omsk" },
  { city: "Новосибирск", zone: "Asia/Novosibirsk" },
  { city: "Томск", zone: "Asia/Tomsk" },
  { city: "Барнаул", zone: "Asia/Barnaul" },
  { city: "Кемерово", zone: "Asia/Novokuznetsk" },
  { city: "Новокузнецк", zone: "Asia/Novokuznetsk" },
  { city: "Красноярск", zone: "Asia/Krasnoyarsk" },
  { city: "Иркутск", zone: "Asia/Irkutsk" },
  { city: "Улан-Удэ", zone: "Asia/Irkutsk" },
  { city: "Чита", zone: "Asia/Chita" },
  { city: "Якутск", zone: "Asia/Yakutsk" },
  { city: "Благовещенск", zone: "Asia/Yakutsk" },
  { city: "Владивосток", zone: "Asia/Vladivostok" },
  { city: "Хабаровск", zone: "Asia/Vladivostok" },
  { city: "Магадан", zone: "Asia/Magadan" },
  { city: "Южно-Сахалинск", zone: "Asia/Sakhalin" },
  { city: "Среднеколымск", zone: "Asia/Srednekolymsk" },
  { city: "Петропавловск-Камчатский", zone: "Asia/Kamchatka" },
  { city: "Анадырь", zone: "Asia/Anadyr" },
  { city: "Алматы", zone: "Asia/Almaty" },
  { city: "Астана", zone: "Asia/Almaty" },
  { city: "Шымкент", zone: "Asia/Almaty" },
  { city: "Караганда", zone: "Asia/Almaty" },
  { city: "Павлодар", zone: "Asia/Almaty" },
  { city: "Усть-Каменогорск", zone: "Asia/Almaty" },
  { city: "Костанай", zone: "Asia/Qostanay" },
  { city: "Кызылорда", zone: "Asia/Qyzylorda" },
  { city: "Актобе", zone: "Asia/Aqtobe" },
  { city: "Актау", zone: "Asia/Aqtau" },
  { city: "Атырау", zone: "Asia/Atyrau" },
  { city: "Уральск", zone: "Asia/Oral" },
]

export const isValidTimezone = (zone: string): boolean => {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// Minutes east of UTC right now ("Asia/Tomsk" → 420); null for an unknown zone.
export const timezoneOffsetMinutes = (zone: string, at = new Date()): number | null => {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value
    if (!name) return null
    const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name)
    if (!m) return null
    if (!m[1]) return 0
    const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0)
    return m[1] === "-" ? -minutes : minutes
  } catch {
    return null
  }
}

// 420 → "UTC+7", 330 → "UTC+5:30", 0 → "UTC".
export const formatUtcOffset = (minutes: number): string => {
  if (minutes === 0) return "UTC"
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const mm = abs % 60
  return `UTC${minutes < 0 ? "−" : "+"}${h}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`
}

export type TimezoneOption = {
  // Unique per row: two cities can share a zone.
  key: string
  zone: string
  label: string
  offset: number | null
  search: string
}

const normalize = (s: string) => s.toLowerCase().replaceAll("ё", "е")

const option = (key: string, zone: string, name: string, at: Date): TimezoneOption => {
  const offset = timezoneOffsetMinutes(zone, at)
  const offsetLabel = offset === null ? null : formatUtcOffset(offset)
  return {
    key,
    zone,
    offset,
    label: offsetLabel ? `${name} (${offsetLabel})` : name,
    search: normalize(`${name} ${zone} ${offsetLabel ?? ""}`),
  }
}

// West to east, then by city name.
export const timezoneOptions = (at = new Date()): TimezoneOption[] =>
  TIMEZONE_CITIES.map((c) => option(`${c.zone}|${c.city}`, c.zone, c.city, at)).sort(
    (a, b) => (a.offset ?? 0) - (b.offset ?? 0) || a.label.localeCompare(b.label, "ru"),
  )

// The row a stored zone reads as: its first city, else the zone itself (a
// club created before this list, or a zone outside Russia/Kazakhstan).
export const timezoneLabel = (zone: string, at = new Date()): string => {
  const city = TIMEZONE_CITIES.find((c) => c.zone === zone)
  return option(zone, zone, city?.city ?? zone, at).label
}

export const filterTimezoneOptions = (
  options: readonly TimezoneOption[],
  query: string,
): TimezoneOption[] => {
  const q = normalize(query.trim())
  if (!q) return [...options]
  return options.filter((o) => o.search.includes(q))
}

// The browser's own zone — the sensible default when a club is created.
export const browserTimezone = (fallback = "Europe/Moscow"): string => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && isValidTimezone(zone) ? zone : fallback
  } catch {
    return fallback
  }
}
