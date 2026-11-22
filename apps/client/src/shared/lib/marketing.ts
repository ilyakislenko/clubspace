// Runtime configuration of the public marketing pages: analytics, search-engine
// verification, contacts and claims that depend on how the instance is hosted.
// Read on the server per request (like app-links.ts), so a container restart
// applies a change. Unset or blank means "off": no counter, no meta tag, no
// link, no claim.

type Env = Record<string, string | undefined>

const value = (env: Env, name: string): string | null => {
  const v = env[name]?.trim()
  return v ? v : null
}

export type MarketingConfig = {
  // Yandex Metrika counter id; digits only, anything else is ignored so a typo
  // cannot inject markup into the page.
  metrikaId: string | null
  yandexVerification: string | null
  googleVerification: string | null
  // A t.me link (or any https URL) for the landing's «Контакты».
  telegramUrl: string | null
  // Only when the operator actually hosts in Russia may the landing say so.
  dataHostedInRu: boolean
}

export const readMarketingConfig = (
  env: Env = process.env,
): MarketingConfig => {
  const metrika = value(env, "YANDEX_METRIKA_ID")
  const telegram = value(env, "SUPPORT_TELEGRAM_URL")
  return {
    metrikaId: metrika && /^\d+$/.test(metrika) ? metrika : null,
    yandexVerification: value(env, "YANDEX_VERIFICATION"),
    googleVerification: value(env, "GOOGLE_SITE_VERIFICATION"),
    telegramUrl: telegram && /^https:\/\//.test(telegram) ? telegram : null,
    dataHostedInRu: value(env, "DATA_HOSTED_IN_RU")?.toLowerCase() === "true",
  }
}

// The official Metrika snippet with Webvisor (session recording) off and no
// e-commerce data layer. Metrika has no IP-anonymisation switch; it never
// exposes raw IPs to the counter owner, which the privacy policy states.
export const metrikaSnippet = (id: string): string =>
  `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};` +
  `m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}` +
  `k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})` +
  `(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");` +
  `ym(${id},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:false});`
