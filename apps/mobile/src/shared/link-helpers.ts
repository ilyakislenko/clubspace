// «+7 952 884-94-20» → «tel:+79528849420»; dialers reject spaces and dashes.
export const telUrl = (phone: string): string =>
  `tel:${phone.replace(/[^\d+]/g, "")}`

// Only http(s) links are opened from club-provided data; the server filters
// too, this is the last check before the OS gets the URL.
export const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)

// «https://academytomsk.ru/» → «academytomsk.ru»: the way people say a site.
export const displayUrl = (url: string): string =>
  url.replace(/^https?:\/\//i, "").replace(/\/$/, "")
