# ClubSpace: competitor research and rules that shape the product

Research date: 2026-11-01. Sources are linked inline. In the per-competitor notes, "not found" means the item was searched for and could not be verified. `[INFERENCE]` marks an analytical conclusion that no source states directly.

---

## 0. Executive summary (10 findings)

1. **Most vendors use the same two-layer model: one free "picker" app from the vendor, plus a paid branded app per club.** Mindbody, Glofox, PushPress, Wodify, Zen Planner, Momence, Walla, Eversports, Kajabi and Circle all ship a vendor container app with an org list or search, and sell a branded app on top ([PushPress](https://www.pushpress.com/products/branded-member-app), [Glofox](https://support.glofox.com/hc/en-us/articles/46443804482196-Frequently-Asked-Questions-about-Your-Standalone-App), [Momence](https://help.momence.com/en/articles/12143278-customer-mobile-app-faqs), [Walla](https://www.hellowalla.com/features/branded-app)). Apple Guideline 4.2.6 explicitly allows the picker model ([Apple](https://developer.apple.com/app-store/review/guidelines/)).
2. **Branded iOS apps are almost always published under the club's own Apple Developer *Organization* account**, with the vendor added as Admin (D-U-N-S number, $99/yr). Mindbody, Glofox, Wodify, Gymdesk, Mariana Tek, Eversports, Kajabi, Uscreen and Circle all work this way ([Glofox: "cannot directly publish your app to our own Apple developer account"](https://support.glofox.com/hc/en-us/articles/46443804482196-Frequently-Asked-Questions-about-Your-Standalone-App), [Mariana Tek](https://support.marianatek.com/en/articles/6985629-how-do-i-set-up-my-apple-developer-account-grant-access-to-mariana-tek-and-provide-the-api-key), [Uscreen](https://help.uscreen.tv/en/articles/10289133-developer-account-requirements-for-your-app)). Some vendors still publish many client apps under their own account: bsport, Hapana, Mobifitness (967 apps in RuStore), Fitbase and YCLIENTS ([Play "More by bsport"](https://play.google.com/store/apps/details?hl=en_GB&id=com.bsport), [RuStore Mobifitness](https://www.rustore.ru/catalog/developer/5019d3dd)). That carries 4.2.6/4.3(a) risk on Apple and §4.6 risk on RuStore.
3. **Club switching only works inside the shared app, never inside a branded app.** PushPress says so outright ([FAQ](https://help.pushpress.com/en/articles/3415630-frequently-asked-questions-about-the-members-app-by-pushpress)). Members are linked across clubs by a shared email (PushPress, Kajabi, Circle) or by account merge (Wodify, TeamUp). Good switchers: Circle shows unread badges per community ([Circle](https://help.circle.so/p/basics/mobile-apps/switching-between-communities-on-the-circle-mobile-app)), and PushPress pushes switch to the right gym automatically.
4. **Nobody publishes a real deferred-deep-link invite.** Spond, Heja, SportEasy, Hudl and CoachNow all make the user install the app and type a code ([Spond invite page](https://spond.com/invite/AXGWO), [CoachNow 6-digit code](https://help.coachnow.io/en/articles/3143317-how-to-accept-an-invitation)). TeamUp doesn't allow joining in the app at all, and its member app is rated 1.9★ ([help](https://support.goteamup.com/en/articles/9327650-connecting-your-customer-account-to-a-new-business), [App Store](https://apps.apple.com/gb/app/teamup-member-booking/id6740145491)). None of the six Russian players lets a member join by code or QR (see §2.3). Zero-friction join is an open opportunity.
5. **Payments for in-person services never go through Apple or Google IAP.** Every gym platform uses Stripe or local acquiring. Apple 3.1.3(e) *requires* non-IAP payment for "services that will be consumed outside of the app". Google Play *forbids* Play Billing for physical services and names "gym memberships" explicitly ([Apple](https://developer.apple.com/app-store/review/guidelines/), [Google](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)).
6. **Video courses sold as digital content fall under IAP.** Thinkific says IAP is "required by Apple and Google for your app to be approved" ([Thinkific](https://support.thinkific.com/hc/en-us/articles/16261125243159-Sell-Products-in-the-Mobile-App)). Kajabi, Circle, Uscreen and Gracie Barra Online sell through IAP. BJJ Fanatics and Skool use a "reader-app" pattern with no purchase in the app ([BJJ Fanatics](https://apps.apple.com/us/app/bjj-fanatics/id1530956257)). In the US, link-out to web checkout has been allowed since May 2025, but the commission rate is still undecided ([MacObserver](https://www.macobserver.com/news/app-store-link-out-commission-rate-not-set-us/)).
7. **Russia is a different distribution world.**
   - Apple stopped App Store payment processing in Russia on 1 April 2026 ([Apple](https://support.apple.com/en-us/126891)).
   - Apple removed 1,213 apps at Roskomnadzor's request in 2025 ([Meduza/Apple transparency report](https://meduza.io/en/news/2026/05/25/apple-removed-1-213-apps-at-russia-s-internet-regulator-s-request-in-2025)), and VK's apps disappeared from the App Store in June 2026 ([Reuters](https://www.reuters.com/world/europe/kremlin-demands-explanation-apple-after-russian-apps-removed-app-store-2026-06-25)). YCLIENTS' consumer app YPLACES is now "not available" on iOS and serves iOS users through a PWA and a MAX bot ([yplaces.com](https://yplaces.com/)).
   - Google Play billing has been paused in Russia since March 2022 ([Google](https://support.google.com/googleplay/android-developer/answer/11950272?hl=en)).
   - RuStore must be preinstalled on phones sold in Russia from 1 September 2025 ([КонсультантПлюс](https://www.consultant.ru/legalnews/29310)).
   - **For ClubSpace this means: PWA plus RuStore plus Google Play in Russia, and iOS as a "nice to have" with a PWA fallback.**
8. **Curriculum, rank and video are split across products.**
   - Rank tracking lives in gym software: Zen Planner, Gymdesk, Kicksite, PushPress.
   - Video lives in creator apps: BJJ Fanatics, Grapplearts.
   - Network curriculum lives in single-brand apps: Gracie Barra Online at $24.99/mo by IAP ([GB](https://online.graciebarra.com/pages/annual-training-pass-1)).
   - Gymdesk comes closest. It gates its content library by rank ([Gymdesk](https://gymdesk.com/features/member-app)) and just bought Smoothcomp, the competition platform used by 80K+ academies ([press](https://gymdesk.com/press/gymdesk-smoothcomp-acquisition)). It is the main strategic threat in BJJ.
9. **The market is consolidating under private equity.**
   - Playlist (Mindbody + ClassPass) merged with EGYM at a $7.5B enterprise value ([Playlist](https://www.playlist.com/press/playlist-and-egym-announce-agreement-merge-and-785-million-new-equity-investments-bringing)).
   - Xplor merged with Clubessential in March 2026 and now owns both Momence and Mariana Tek ([Xplor](https://xplor.com/press/xplor-technologies-and-clubessential-holdings-launch-unified-global-company-under-xplor-brand/)).
   - Daxko owns Zen Planner and Exercise.com ([Athletech](https://athletechnews.com/daxko-acquires-exercise-com-boutique-fitness-tech/)), and ABC Fitness (Thoma Bravo) owns Glofox ([Thoma Bravo](https://www.thomabravo.com/press-releases/abc-fitness-solutions-completes-its-acquisition-of-glofox-paving-the-way-to-create-one-of-the-largest-global-fitness-tech-companies)).
   - Recent venture rounds: Arketa $15M A ([blog](https://www.arketa.com/blog/series-a-fundraise.md)), bsport €30M B ([Athletech](https://athletechnews.com/bsport-raises-e30m-boutique-fitness-software/)), PushPress $20M B ([Athletech](https://athletechnews.com/pushpress-secures-20m-for-one-stop-solution-for-gym-owners/)), 360Player SEK 250M ([press](https://www.360player.com/press/360player-receives-25-million-investment-from-five-elms-capital-to-accelerate-global-expansion-of-sports-management-software)).
10. **Studios dislike marketplaces that show competitors.** Walla ("never a competitor"), Arketa ("not a marketplace") and Altegio's Aunio (users can book only at places they already visited) sell this as a feature. Eversports draws Capterra complaints about its marketplace commission ([Walla](https://www.hellowalla.com/features/branded-app), [Arketa](https://www.arketa.com/pricing.md), [Altegio PR](https://websummit.com/wp-media/2024/11/Altegio-Press-Release.pdf), [Capterra](https://www.capterra.in/reviews/161944/eversports-manager)). `[INFERENCE]` ClubSpace's container app should show only the clubs the user belongs to, with no cross-promotion.

---

## 1. Matrix (compact)

Legend:
- **Multi-org:** how a person in several organizations finds and switches them.
- **Store:** C = vendor container/picker app; B-club = branded app on the club's own developer account; B-vendor = branded apps under the vendor's account; PWA = web app only.

### 1.1 Club / studio / gym management (global)

| Product | Segment | Pricing (as found) | Multi-org | Store | Payments | Video | Signals |
|---|---|---|---|---|---|---|---|
| Mindbody | Fitness, wellness and beauty studios | From $79/loc/mo US; tiers by quote; branded app only on upper tiers ([blog](https://www.mindbodyonline.com/business/education/blog/mindbody-pricing-united-states), [pricing](https://www.mindbodyonline.com/business/pricing)) | Consumer marketplace: search by location, one account ([App Store](https://apps.apple.com/us/app/mindbody-fitness-wellness/id689501356)) | C + B-club ([FAQ](https://support.mindbodyonline.com/s/article/Branded-mobile-app-launch-requirements-FAQ)) | Mindbody Payments on Stripe ([Stripe](https://stripe.com/customers/mindbody)) | Livestream + VOD ([help](https://support.mindbodyonline.com/s/article/Live-stream-FAQ?language=en_US)) | Playlist + EGYM, $7.5B EV ([PR](https://www.playlist.com/press/playlist-and-egym-complete-merger-power-worlds-most-comprehensive-fitness-and-wellness)) |
| Glofox (ABC) | Studios, gyms, franchises (incl. a BJJ club) | From $99/mo ([plans](https://www.glofox.com/plans/)) | Member app: search studio by name or city ([help](https://support.glofox.com/hc/en-us/articles/54406173004692-Introducing-the-refreshed-Glofox-Member-App)) | C + B-club, D-U-N-S required ([help](https://support.glofox.com/hc/en-us/articles/46443858038292-Standalone-App-Requirements-and-Process)) | Stripe ([help](https://support.glofox.com/hc/en-us/articles/46466480893204-How-to-Set-up-Glofox-Payments-Stripe)) | Live/VOD via links or Zoom ([FAQ](https://www.glofox.com/faq/)) | ABC/Thoma Bravo ([PR](https://www.thomabravo.com/press-releases/abc-fitness-solutions-completes-its-acquisition-of-glofox-paving-the-way-to-create-one-of-the-largest-global-fitness-tech-companies)) |
| Zen Planner (Daxko) | Martial arts, CrossFit | $99–$289/mo by active members; branded app $39/mo ([pricing](https://www.zenplanner.com/pricing/active-member-tiers)) | One app logs into "all of your Zen Planner accounts" ([App Store](https://apps.apple.com/us/app/zen-planner-member-app/id1065000091)) | C + branded | Zen Planner Payments, "Flex Fees" ([pricing](https://www.zenplanner.com/pricing/active-member-tiers)) | SugarWOD workouts ([page](https://www.zenplanner.com/products/mobile-app)) | Daxko 2017 ([PRN](https://www.prnewswire.com/news-releases/daxko-acquires-zen-planner-to-become-preeminent-software-provider-in-member-based-health--wellness-industry-300426349.html)) |
| PushPress | CrossFit, BJJ, Hyrox | Free (4.99%+$0.30), Pro $159, Max $229; branded app $97 ([blog](https://www.pushpress.com/blog/what-does-gym-software-really-cost)) | Same email, tap gym logo; pushes auto-switch the gym; no switcher in branded app ([FAQ](https://help.pushpress.com/en/articles/3415630-frequently-asked-questions-about-the-members-app-by-pushpress)) | C + B-club (iOS); vendor publishes on Android ([page](https://www.pushpress.com/products/branded-member-app)) | Stripe | Train library (YouTube/Vimeo) ([help](https://help.pushpress.com/en/articles/5949787-building-your-media-library-in-train-by-pushpress)) | $20M Series B ([Athletech](https://athletechnews.com/pushpress-secures-20m-for-one-stop-solution-for-gym-owners/)) |
| Wodify | CrossFit | Branded app $79/mo ([Wodify](https://www.wodify.com/products/branded-app)) | Merge accounts, then "Switch Business" ([help](https://help.wodify.com/hc/en-us/articles/360058012434-Switching-Between-your-Businesses-Gyms-etc-)) | C + B-club ([help](https://help.wodify.com/hc/en-us/articles/38961734699799-Granting-Wodify-Access-to-Your-Apple-Developer-Account)) | Stripe ([Wodify](https://www.wodify.com/products/payments)) | not found | Bootstrapped ([interview](https://twobrainbusiness.com/two-brain-business-wodify/)) |
| Gymdesk | Martial arts, gyms | $75–$200/mo by members; branded app +$100 ([blog](https://gymdesk.com/blog/gym-management-software-cost)) | Email login; no switcher found ([docs](https://docs.gymdesk.com/en/help/docs/member-portal-access-and-login)) | C + B-club, org account only ([docs](https://docs.gymdesk.com/en/help/docs/branded-member-app)) | Gymdesk Payments | Content library gated by rank or program ([features](https://gymdesk.com/features/member-app)) | $32.5M Five Elms ([TinySeed](https://tinyseed.com/latest/tinyseed-backed-gymdesk-has-raised-a-325m-strategic-growth-investment-from-five-elms-capital)); bought Smoothcomp ([press](https://gymdesk.com/press/gymdesk-smoothcomp-acquisition)) |
| Kicksite | Martial arts schools | $49–$199/mo by students ([FAQ](https://kicksite.com/faq/)) | Per-school subdomain ([KB](https://kicksite.com/knowledge-base/faq-how-do-i-use-kicksite-as-an-app/)) | PWA only ([KB](https://kicksite.com/knowledge-base/install-member-portal/)) | Basys (US), Stripe ([page](https://kicksite.com/payment-processing/)) | not found | Independent ([site](https://kicksite.com/martial-arts-management-software/)) |
| Spark Membership | Martial arts | $199/mo ([site](https://sparkmembership.com/)) | 4-digit location ID; switch locations without logout ([help](https://help.sparkmembership.com/en/articles/5392659-member-app-updates)) | C + white-label | Through Spark | Curriculum videos ([App Store](https://apps.apple.com/us/app/spark-member/id1453013929)) | 3.7★ app |
| Exercise.com (Daxko) | Boutique gyms, trainers | From $239/mo ([Capterra](https://www.capterra.com/p/152284/exercise-com/)) | One app or one per brand, for chains ([page](https://www.exercise.com/platform/multi-location/)) | C + B-club ([support](https://www.exercise.com/support/topics/apple-developer-account-setup/)) | Stripe ([support](https://www.exercise.com/support/set-up-stripe-tax/)) | VOD + live ([page](https://www.exercise.com/platform/on-demand/)) | Daxko, Oct 2025 ([Athletech](https://athletechnews.com/daxko-acquires-exercise-com-boutique-fitness-tech/)) |
| Clubworx | Martial arts, gyms (AU) | Free ≤20 members, $109/$149/$169 ([pricing](https://www.clubworx.com/pricing-us)) | Email invite; family login ([help](https://intercom.help/clubworx/en/articles/5870461-inviting-your-members-to-your-mobile-app)) | C + B-club ([help](https://intercom.help/clubworx/en/articles/11645216-how-to-create-your-apple-developer-account)) | Ezidebit, Stripe, GoCardless ([page](https://www.clubworx.com/feature-benefits/integrate-with-stripe-ezidebit-integrapay-bluefin/)) | Workout library | not found |
| Arketa | Boutique, wellness | $49/mo + 3% + Stripe; studio plans by quote ([pricing](https://www.arketa.com/pricing.md)) | No cross-brand app: "not a marketplace" ([pricing](https://www.arketa.com/pricing.md)) | Branded only | Stripe | VOD, Apple TV/Roku ([page](https://www.arketa.com/features/on-demand-library)) | $15M Series A, 2025 ([blog](https://www.arketa.com/blog/series-a-fundraise.md)) |
| Momence (Xplor) | Studios | By quote; branded app $250/mo ([help](https://help.momence.com/en/articles/15862446-request-a-branded-app-custom-mobile-app)) | One consumer app; nearby/search; "Add host" ([help](https://help.momence.com/en/articles/12143278-customer-mobile-app-faqs)) | C + branded | Stripe | VOD + Zoom | 4.9★ / 47K ratings ([App Store](https://apps.apple.com/us/app/momence/id1577856009)) |
| bsport | Boutique (EU) | By quote ([pricing](https://pro.bsport.io/pricing)) | Marketplace app, 3,000 partners ([App Store](https://apps.apple.com/at/app/bsport/id1356621554?l=en-GB)) | C + B-vendor ([Play](https://play.google.com/store/apps/details?hl=en_GB&id=com.bsport)) | Stripe Connect, about $25M/mo ([Stripe](https://www.stripe.com/us/customers/bsport)) | VOD, Zoom | €30M Series B ([Athletech](https://athletechnews.com/bsport-raises-e30m-boutique-fitness-software/)) |
| Eversports | Studios (DACH) | €49–€229/mo by bookings + €99 setup ([pricing](https://www.eversportsmanager.com/en/pricing)) | Marketplace app; branded apps reuse the Eversports account ([help](https://helpcenter.eversportsmanager.com/your-branded-app-is-coming-in-q1-2025)) | C + B-club | Stripe (SEPA, Twint) | Live + VOD | Verdane; merged with MATCHi ([deal](https://www.startupsacquired.com/deals/eversports-acquires-matchi)) |
| Virtuagym | Gyms, personal trainers | By quote ([pricing](https://business.virtuagym.com/our-prices)) | Club code; Club Finder for chains ([page](https://business.virtuagym.com/multi-club-management)) | C + B-club ([page](https://business.virtuagym.com/custom-mobile-app/)) | Virtuagym Pay (Mollie, GoCardless) | Video workouts | about $13.4M raised ([Tracxn](https://tracxn.com/d/companies/virtuagym/__U2VVXhZxYqgvzV3YNCPfh1gDsSDMvAHmcqER7d-2mDA)) |
| TeamUp (DaySmart) | Studios, boxes | $189/mo for 101–200 customers; branded app £79 ([pricing](https://goteamup.com/pricing)) | One account across many businesses; dashboard switch; join only via web or email ([help](https://support.goteamup.com/en/articles/9327650-connecting-your-customer-account-to-a-new-business)) | C + branded | Stripe + GoCardless | On-demand | Member app 1.9★ ([App Store](https://apps.apple.com/gb/app/teamup-member-booking/id6740145491)) |
| Mariana Tek (Xplor) | Premium boutique | By quote; branded app included ([pricing](https://www.marianatek.com/pricing/)) | One branded app per brand; private app with access code ([help](https://support.marianatek.com/en/articles/12860760-can-our-studio-app-be-private)) | B-club ([help](https://support.marianatek.com/en/articles/6985629-how-do-i-set-up-my-apple-developer-account-grant-access-to-mariana-tek-and-provide-the-api-key)) | Stripe | Third-party only (Zoom, Vimeo OTT) ([help](https://support.marianatek.com/en/articles/3879218-how-do-i-add-a-livestream-or-video-on-demand-class)) | Xplor |
| Walla | Boutique | From $299/loc/mo; branded app $169 ([pricing](https://www.hellowalla.com/pricing), [app](https://www.hellowalla.com/features/branded-app)) | Free app, "two arrows" switch, only your own studios ([support](https://support.hellowalla.com/clients-and-multiple-walla-studios-walla-support-center)) | C + branded | Stripe; optional 3.9% fee pass-through | Video library, Zoom | $13M, 2022 ([BusinessWire](http://businesswire.com/news/home/20220714005154/en/Walla-Software-Lands-%2413M-Investment-to-Help-Boutique-Fitness-Studios-Adapt-To-A-New-Normal)) |
| Hapana | Premium multi-site | By quote ([site](https://www.hapana.com/)) | One branded app per brand | B-vendor ([Play](https://play.google.com/store/apps/details?id=com.onefitstop.client&hl=en_US)) | Stripe Connect, Ezypay ([Stripe](https://stripe.com/en-be/customers/hapana)) | Live + VOD, sellable add-on | A$17.3M + $7.25M ([blog](https://www.hapana.com/blog/hapana-raises-7-25m-platform-growth)) |

### 1.2 Russia / CIS

| Product | Segment | Pricing | Multi-org | Store | Payments | Video | Signals |
|---|---|---|---|---|---|---|---|
| 1С:Фитнес клуб | Fitness through to martial arts and kids' clubs | 2 660–7 210 ₽/мес; client app +5 740 ₽/мес ([price](https://www.fitness1c.ru/price)) | Client app built through Mobifitness ([KB](https://www.fitness1c.ru/knowledge-base/integratsii/mobilnoe-prilozhenie/mobilnoe-prilozhenie-klienta)) | Branded (via Mobifitness) | ЮKassa, Яндекс Пэй, СБП; 54-ФЗ ([page](https://www.fitness1c.ru/integrations/fiskalizatsiya-onlayn-platezhey)) | not found | 6000+ clients ([about](https://www.fitness1c.ru/about)) |
| Mobifitness | Fitness, yoga, dance | Branded app from 2 870 ₽/мес ([app](https://mobifitness.ru/app/)) | Aggregator app: Country → City → Club, picked once ([App Store](https://apps.apple.com/ru/app/mobifitness/id986278836)) | C + B-vendor (967 apps in RuStore) ([RuStore](https://www.rustore.ru/catalog/developer/5019d3dd)) | ЮKassa, CloudPayments, Т-Банк and others ([page](https://mobifitness.ru/online-payment/)) | YouTube/VK embeds, Zoom | 4 000+ clubs, 1M+ users ([app](https://mobifitness.ru/app/)) |
| AppEvent | Fitness, dance, martial arts | Branded app from 2 200 ₽/мес ([page](https://appevent.ru/dance)) | One branded app per club | B-vendor (iOS under an individual's account) ([App Store](https://apps.apple.com/ru/app/pole-dom/id6470196952)) | Built-in 54-ФЗ, Life Pay | Zoom ([page](https://appevent.ru/zoom)) | Founded 2016 |
| Fitbase | Fitness studios (RU/KZ/UZ) | From 5 417 ₽/мес; acquiring 2.7–3.5%, СБП 1.5% ([price](https://fitbase.io/price)) | Fitbase GO shared app with club switch ([App Store](https://apps.apple.com/ru/app/fitbase-go/id1535178540)) | C + B-vendor | ЮKassa, CloudPayments; CloudKassir ([help](https://help.fitbase.io/article/23889)) | not found | 1 700+ clubs |
| МойКласс | Kids' and education centres | 911–5 603 ₽/мес; student app 990–1 190 ₽/мес ([prices](https://moyklass.com/prices)) | Shared app «Твой Класс»; credentials issued by the centre; child switcher ([help](https://help.moyklass.com/ru/knowledge_base/art/144/cat/20/prilozenie-dlja-uchenikov-tvoj-klass)) | C only | 10+ acquirers; КОМТЕТ Касса ([help](https://help.moyklass.com/ru/knowledge_base/cat/21/onlajn-platezi-i-kassi)) | Homework only | App 2.9★ ([App Store](https://apps.apple.com/ru/app/id1635705813)) |
| YCLIENTS / Altegio | Beauty, also fitness | Staff tiers; branded app 40 000 ₽/год ([help](https://support.yclients.com/41-693-366--mobilnoe-prilozhenie-ot-yclients)) | YPLACES marketplace, 60k locations; **not on iOS**, PWA instead ([yplaces.com](https://yplaces.com/)) | C + B-vendor | ЮKassa, Т-Банк, СБП ([page](https://www.yclients.ru/online_payments)) | not found | Owned by VK ([AIN](https://en.ain.ua/2023/12/26/russias-vk-acquires-yclients-operates-in-ukraine-altegio/)); Altegio uses Stripe/Adyen ([about](https://alteg.io/en/info/about)) |

### 1.3 Courses, community, video and martial-arts content

| Product | Segment | Pricing | Multi-org | Store | Payments / IAP | Signals |
|---|---|---|---|---|---|---|
| Kajabi | Creators | $179/$249/$499 per month; branded app $199/mo ([Kajabi](https://kajabi.com/updates/2025-pricing-updates), [FAQ](https://help.kajabi.com/articles/mobile-apps/branded-app/kajabi-branded-app-faqs)) | "Sites" menu, keyed on email ([help](https://help.kajabi.com/en/articles/17300001-log-in-to-a-kajabi-mobile-app)) | C + B-club | IAP in the branded app; web links for expensive items ([FAQ](https://help.kajabi.com/articles/mobile-apps/branded-app/kajabi-branded-app-faqs)) | $550M at $2B+ |
| Teachable | Solo creators | $39–$189/mo; 7.5% fee on Starter ([pricing](https://www.teachable.com/pricing)) | Switch between schools ([guide](https://support.teachable.com/en/articles/11682448-teachable-ios-app-guide-for-creators)) | C only | No IAP; "Discover" tab for US users only ([App Store](https://apps.apple.com/us/app/teachable-online-courses/id1177062376)) | Hotmart, about $250M |
| Thinkific | Academies, B2B | $82–$374/mo; branded app $199/mo ([plans](https://www.thinkific.com/blog/which-thinkific-plan-for-you)) | Search school by name ([help](https://support.thinkific.com/hc/en-us/articles/11917598555287-Install-and-Navigate-the-Mobile-App)) | C + B-club | IAP "required"; subscriptions can't be sold in-app ([help](https://support.thinkific.com/hc/en-us/articles/16261125243159-Sell-Products-in-the-Mobile-App)) | App 1.8★ |
| Skool | Paid communities | $9 (10% fee) / $99 ([pricing](https://www.skool.com/pricing)) | Community switcher | C only | No IAP shown (reader-style) ([App Store](https://apps.apple.com/us/app/skool-communities/id6447270545)) | — |
| Circle | Brand communities | $89–$419/mo; branded app only on Plus ([pricing](https://circle.so/_llms/pricing.md)) | "Switch community" with unread badges ([help](https://help.circle.so/p/basics/mobile-apps/switching-between-communities-on-the-circle-mobile-app)) | C + B-club | IAP in branded apps ([help](https://help.circle.so/p/branded-apps/in-app-purchases/in-app-purchases-overview)) | 4.9★ / 86K |
| Mighty Networks | Communities | $79–$354/mo; Mighty Pro ~$17k+/yr (3P) ([pricing](https://www.mightynetworks.com/pricing)) | Email link lists all networks; "Switch Networks" ([docs](https://docs.mightynetworks.com/for-hosts/setting-up-your-network/does-mighty-networks-have-an-app)) | C + B (Pro) | IAP at 15% in the shared app ([docs](https://docs.mightynetworks.com/for-hosts/payments-and-access/does-mighty-networks-charge-a-transaction-fee)) | $50M Series B |
| Uscreen | Video subscriptions (fitness, yoga) | $49 / $149 + $1.99 per subscriber / $449 with apps ([plans](https://www.uscreen.tv/plans-comparison/)) | One branded app per creator | B-club, org account ([help](https://help.uscreen.tv/en/articles/10289133-developer-account-requirements-for-your-app)) | IAP subscriptions ([help](https://help.uscreen.tv/en/articles/6194316-subscription-pricing-free-trials-for-in-app-purchases)) | $150M PSG ([about](https://www.uscreen.tv/about-us/)) |
| Patreon | Creators | 10% fee (3P) | One feed of many creators | C | IAP outside the US; US web checkout ([FAQ](https://support.patreon.com/hc/en-us/articles/28801582599181-Migrating-to-subscription-billing-FAQ)) | $4B (2021) |
| GetCourse (RU) | Online schools | 5 900–145 000 ₽/мес ([prices](https://getcourse.ru/prices)) | "Настроить аккаунты" list; QR login can't switch schools ([blog](https://getcourse.ru/blog/1203081)) | C (App Store + RuStore) | Own GetCourse Pay ≤3.5%, receipts included ([page](https://getcourse.ru/getcoursepay)) | 158B ₽ school revenue in 2025 ([blog](https://getcourse.ru/marketing-blog/1198607/year2025)) |
| BJJ Fanatics | BJJ instructionals | ~$349 per title (3P) | n/a | Own app | Reader pattern: link to website ([App Store](https://apps.apple.com/us/app/bjj-fanatics/id1530956257)) | ~$19.8M online sales (3P est.) |
| Grapplearts | Self-learners | e.g. $97–$147 per course ([page](https://www.grapplearts.com/the-submission-formula-with-rob-biernacki-and-stephan-kesting/)) | n/a | Own app | IAP for in-app modules ([page](https://www.grapplearts.com/grapplearts-bjj-master-app/)) | — |
| Gracie University | Beginners + licensed academies (CTC) | $279 one-time ([gc2](https://gc2.gracieuniversity.com/)) | Network licence; CTC students get online access ([ICP](https://www.gracieuniversity.com/icp)) | Web | Web checkout | Online belt-test controversy ([BJJEE](https://www.bjjee.com/articles/rickson-gracies-statement-on-gracie-university-online-blue-belts/)) |
| Gracie Barra Online | Students of 900+ GB schools | $24.99/mo, $249.99/yr ([GB](https://online.graciebarra.com/pages/annual-training-pass-1)) | Network app; no per-school link found | Own app | IAP subscription ([App Store](https://apps.apple.com/us/app/gracie-barra-online/id1541334460)) | — |
| MGinAction | BJJ technique library | was $25/mo | — | Reader app | Web | **Closed** ([site](https://www.mginaction.com/)) |
| GrappleOS | BJJ gyms + athletes | not found | "multiple gym affiliations" in one app ([App Store](https://apps.apple.com/us/app/grappleos/id6795693414)) | C | Gym's own Stripe | New entrant (Aug 2026) |
| Marune | Personal training log, belts across arts | Free + IAP ([App Store](https://apps.apple.com/us/app/marune/id1405069801)) | No gym link | C | IAP | 4.6★ / 96 |

### 1.4 Team and club communication

| Product | Pricing model | Multi-org | Invite | Payments fee | Signals |
|---|---|---|---|---|---|
| TeamSnap | Free with ads; Premium/Ultra per team; ONE for clubs ([Secondslide](https://go.secondslide.io/teamsnap-pricing/)) | Team list; join via email invite, auto-accepted for existing accounts ([help](https://helpme.teamsnap.com/article/133-adding-a-team)) | Email | 3.25% + $1.50 ([help](https://helpme.teamsnap.com/article/1359-managing-invoices)) | Waud Capital ([PR](https://www.waudcapital.com/en/media/waud-capital-completes-growth-capital-partnership-with-teamsnap)) |
| Spond | Free; earns on payments ([help](https://help.spond.com/app/en/articles/118091-payments-costs-in-the-spond-app)) | Groups list; groups can't be searched ([help](https://help.spond.com/app/en/articles/130403-join-a-group)) | Code, link, email/SMS | €0.20 + 2.5% (Stripe) | 12M users; NOK 137.6M revenue ([NKP](https://www.mainsights.io/ma-news/verdane-backed-sportstech-spond-raises-new-capital-from-existing-investors-to-fund-further-growth-investments)) |
| Heja | Free with ads; Pro from $8.33 ([pricing](https://heja.io/pricing)) | "Switch team" ([help](https://help.heja.io/en/articles/12310118-managing-multiple-teams-on-heja)) | Code + link | Tracking only | 235K teams ([App Store](https://apps.apple.com/us/app/heja/id1157335714)) |
| SportEasy | €0.33–0.45 per member/mo ([plans](https://www.sporteasy.net/en/clubs/plans/)) | "Change team"; different role per team ([help](https://sporteasy.zendesk.com/hc/en-gb/articles/360007524313-Navigate-from-one-team-to-the-other-iOS-Android-apps)) | Email, code, link | 1.3% EUR, covered by optional tip ([help](https://sporteasy.zendesk.com/hc/en-gb/articles/7517728368786-Collecting-payments-in-and-What-are-costs-for-my-club)) | €5M Series A |
| Stack Team App | Free with ads ([support](https://support.teamapp.com/en/knowledgebase/5-general-faqs/docs/97-cost-of-team-app)) | Home screen list; search club → request → admin approves ([FAQ](https://www.teamapp.com/faqs)) | Search + approve | Store fees | Play 2.8★ ([Play](https://play.google.com/store/apps/details?hl=en_US&id=com.teamapp.teamapp)) |
| 360Player | Quote ([pricing](https://www.360player.com/en-us/pricing)) | Group switcher in header; parents see children's groups ([help](https://help.360player.com/en/articles/10205630-change-groups)) | not found | Stripe | SEK 250M (Five Elms) |
| Hudl | $500–$2,500 per team per year ([pricing](https://www.hudl.com/pricing/club/soccer)) | Avatar → team | Codes | not found | 18 acquisitions ([SBJ](https://www.sportsbusinessjournal.com/Articles/2025/10/22/hudl-makes-18th-acquisition-adding-athletic-data-innovations-for-elite-sports-load-management/)) |
| CoachNow | $59–$899 per coach per year ([pricing](https://coachnow.com/pricing)) | Spaces + Groups | 6-digit single-use code ([help](https://help.coachnow.io/en/articles/3143317-how-to-accept-an-invitation)) | Stripe Connect | Golf Genius ([blog](https://coachnow.com/blog/golf-genius-acquisition)) |

---

## 2. Rules that shape the product

### 2.1 Apple App Store
All quotes are from the [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
- **4.2.6, template / white-label apps.** "Apps created from a commercialized template or app generation service will be rejected unless they are submitted directly by the provider of the app's content." The alternative is "a single binary to host all client content in an aggregated or 'picker' model". → A ClubSpace container app with a club list is compliant. A per-club branded app must be submitted from the **club's own** developer account; this is how Mindbody, Glofox, PushPress, Wodify and Mariana Tek comply (links in §1.1).
- **4.3(a), spam.** "Don't create multiple Bundle IDs of the same app… If your app has different versions for specific locations, sports teams, universities, etc., consider submitting a single app". → This is another argument against mass-publishing branded apps from the ClubSpace account.
- **3.1.1, in-app purchase.** IAP is required "to unlock features or functionality within your app (… subscriptions, … access to premium content…)". Apps "may not use their own mechanisms to unlock content … such as license keys … QR codes". → Video courses or libraries **sold as digital content** inside the app need IAP outside the US and EU exceptions.
- **3.1.3(e), goods and services outside of the app.** "If your app enables people to purchase physical goods or services that will be consumed outside of the app, you **must** use purchase methods other than in-app purchase". → Memberships, class packs and personal training at the club **must** be paid by card or acquiring, not IAP.
- **3.1.3(d), person-to-person services.** Real-time 1:1 services ("fitness training") may skip IAP. **"One-to-few and one-to-many real-time services must use in-app purchase."** → Paid online group classes or livestreams sold in-app need IAP. Livestreams bundled into a gym membership are a grey area `[INFERENCE]`.
- **3.1.3(a), reader apps.** Covers previously purchased "video" content. Reader apps may link to an account website through the External Link Account Entitlement. → Pattern for "content is granted by the club; nothing is sold in-app" (used by BJJ Fanatics and MGinAction).
- **3.1.3(b), multiplatform.** Users may access content bought elsewhere "provided those items are also available as in-app purchases within the app".
- **US storefront (since May 2025).** Entitlements "are not required for developers to include buttons, external links, or other calls to action in their United States storefront apps" ([guidelines](https://developer.apple.com/app-store/review/guidelines/), [TechCrunch](https://techcrunch.com/2025/05/02/apple-changes-us-app-store-rules-to-let-apps-redirect-users-to-their-own-websites-for-payments)). The Ninth Circuit allows Apple to set some commission later; the rate is undecided as of September 2026 ([MacObserver](https://www.macobserver.com/news/app-store-link-out-commission-rate-not-set-us/)). The Supreme Court took a narrow question on the case ([MacObserver](https://www.macobserver.com/news/supreme-court-apple-epic-appeal-question-1-narrow/)).
- **EU (DMA), unified terms from 1 October 2026** ([Apple](https://developer.apple.com/support/dma-and-apps-in-the-eu)):
  - Rates: IAP 26% (15% for small businesses), alternative in-app payment processing 20% / 10%, out-of-app link offers 15% / 10%.
  - The Core Technology Commission is 5% for distribution outside the App Store; the per-install Core Technology Fee is gone.
  - The chosen payment options must be kept for 12 months.
  - Parental gates apply to users under 18.
- **Account deletion.** "If your app supports account creation, you must also offer account deletion within the app" ([guidelines](https://developer.apple.com/app-store/review/guidelines/), [Apple help](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)). Note this deletes the person's whole account, not just a club membership.
- **4.8, login services.** An equivalent privacy-preserving login is needed only if a third-party or social login is used. Email OTP alone doesn't trigger it ([guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- **1.2, user-generated content.** Chats and feeds need filtering, reporting, blocking and published contact info ([guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- **5.1.2, data use.** Explicit permission is needed before sharing data with third parties, "including with third-party AI" ([guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- **Russia.** Apple stopped App Store payment processing from 1 April 2026; new purchases and renewals only work from an existing balance ([Apple](https://support.apple.com/en-us/126891)). Apps are being removed at the regulator's request ([Apple transparency report 2025](https://www.apple.com/legal/app-store/transparency/2025)), and VK apps were removed in June 2026 ([Reuters](https://www.reuters.com/world/europe/kremlin-demands-explanation-apple-after-russian-apps-removed-app-store-2026-06-25)). `[INFERENCE]` Any iOS monetisation via IAP in Russia is impossible. Listing risk for apps tied to sanctioned or Russian-government-pressured entities is material, so a PWA fallback is mandatory.

### 2.2 Google Play
- **Payments policy.** Play Billing is required for "digital content or goods". It **must not** be used where payment is for "physical services (such as … gym memberships … tickets for live events)" ([Play policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)). Subscriptions to "fitness … education … video" content are listed as Play Billing cases (same page).
- **US.** After Epic v. Google, US developers may offer alternative billing and external links under Google's programmes and fees ([Google](https://support.google.com/googleplay/android-developer/answer/15582165?hl=en), [alt billing US](https://support.google.com/googleplay/android-developer/answer/16497028?hl=en-EN), [The Verge on fees](https://www.theverge.com/news/848540/google-app-fees-external-link-downloads-alternative-payments)).
- **Russia.** Play billing has been paused since 10 March 2022 ([Google](https://support.google.com/googleplay/android-developer/answer/11950272?hl=en)). Free apps can still be distributed.
- **Account deletion.** Required in the app and through a web link ([Google](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)).

### 2.3 RuStore
All points are from the [moderation rules](https://www.rustore.ru/help/developers/publishing-and-verifying-apps/requirement-apps) unless noted.
- **§9.1:** all payment solutions must be declared in the console: IAP, third-party acquiring, own solutions. Undeclared payment methods are forbidden.
- **§5.1:** a privacy policy is mandatory under 152-ФЗ.
- **§4.6:** forbids "приложения, единственная функциональность которых – повторение функциональности другого приложения этого же или другого разработчика с минимальными отличиями (множественные публикации одного и того же приложения)" (apps whose only function repeats another app with minimal differences, i.e. multiple publications of one app). → Mass branded clones carry a moderation risk, even though Mobifitness lists 967 such apps ([RuStore](https://www.rustore.ru/catalog/developer/5019d3dd)).
- **Daily submission limits:** up to 10 apps per day for individuals; set individually for legal entities.
- **Preinstall:** RuStore must be preinstalled on smartphones sold in Russia from 1 September 2025 ([КонсультантПлюс](https://www.consultant.ru/legalnews/29310), [Interfax](https://www.interfax.ru/russia/1034963)).
- **Publishing account:** requires VK ID and a legal entity, sole trader (ИП) or individual account ([RuStore](https://www.rustore.ru/developer)).

### 2.4 Invite links and deep links
- **Firebase Dynamic Links shut down on 25 August 2025.** Every link now returns an error, so do not use FDL ([Firebase FAQ](https://firebase.google.com/support/dynamic-links-faq)).
- **Building blocks:**
  - iOS Universal Links with apple-app-site-association ([Apple](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app)).
  - Android App Links with assetlinks.json ([Android](https://developer.android.com/training/app-links/configure-assetlinks)).
  - Play Install Referrer, which passes the invite token through a Google Play install without a vendor SDK ([Android](https://developer.android.com/google/play/installreferrer)).
  - App Clips / App Clip Codes for a QR at the front desk ([Apple](https://developer.apple.com/documentation/appclip/creating-app-clip-codes)).
  - Paid deferred deep linking: Branch ([Branch](https://help.branch.io/marketer-hub/deep-link-reference)).
- **Competitor practice:**
  - Install-then-type-code: Spond, Heja, CoachNow ([Spond](https://spond.com/invite/AXGWO), [CoachNow](https://help.coachnow.io/en/articles/3143317-how-to-accept-an-invitation)).
  - Email invite attaches the org to the existing account: TeamSnap ([help](https://helpme.teamsnap.com/article/133-adding-a-team)).
  - Web sign-up shows a QR code to the app: Momence ([help](https://help.momence.com/en/articles/12143278-customer-mobile-app-faqs)).
  - Kiosk QR sign-up: PushPress ([page](https://www.pushpress.com/products/branded-member-app)).
  - Hidden network opened from mobile web via "View in App": Mighty ([docs](https://docs.mightynetworks.com/for-hosts/setting-up-your-network/does-mighty-networks-have-an-app)).
- **`[INFERENCE]` Recommended for ClubSpace: an identity-bound invite.**
  - The link opens a web landing page (PWA). The user confirms by email OTP, and the membership is created **on the server**.
  - After installing the app, the user logs in with the same email and the club is already there. This works on iOS, Android, RuStore and PWA with no deferred-link vendor.
  - Add the Play Install Referrer to prefill the code, a short club code as a fallback, and a QR code at the front desk.

### 2.5 Data protection
- **152-ФЗ, localisation (ч. 5 ст. 18).** Since 1 July 2025 (23-ФЗ), using databases located outside Russia when *collecting* Russian citizens' personal data is prohibited. Fines are up to 6M ₽, and up to 18M ₽ for a repeat offence ([Comply](https://comply.ru/tpost/c43ezsout1-lokalizatsiya-i-transgranichnaya-peredac), [law text](http://publication.pravo.gov.ru/file/pdf?eoNumber=0001202502280034)). → The primary database and the OTP/e-mail flow for Russian users must run on Russian hosting. Third-party analytics and captcha that collect data from outside Russia count as "collection" (same source).
- **Separate consent.** From 1 September 2025 (156-ФЗ), consent to process personal data must be a separate document, not buried in an offer or terms ([Garant](https://www.garant.ru/news/1850806), [1С ИТС](https://its.1c.ru/db/content/newscomm/src/495627.htm)).
- **Fines.** Turnover-based fines for leaks have applied since 30 May 2025 ([КонсультантПлюс](https://www.consultant.ru/legalnews/28492/)).
- **54-ФЗ.** Online payments from individuals need a fiscal receipt through an online cash register ([ФНС](https://www.nalog.gov.ru/rn25/news/activities_fts/12511597/), [Альфа-Банк docs](https://alfabank.ru/sme/payservice/internet-acquiring/docs/fiscalization-i/)). Every Russian competitor integrates a cloud cash register: CloudKassir, Orange Data, КОМТЕТ (links in §1.2).
- **GDPR basics for the EU.**
  - It applies to offering services to people in the EU ([Art. 3](https://gdpr-info.eu/art-3-gdpr/)).
  - ClubSpace is a processor for the clubs and needs a DPA with each club ([Art. 28](https://gdpr-info.eu/art-28-gdpr/)).
  - Data subjects have rights to erasure and portability ([Art. 17](https://gdpr-info.eu/art-17-gdpr/), [Art. 20](https://gdpr-info.eu/art-20-gdpr/)).
  - Breaches must be reported within 72 hours ([Art. 33](https://gdpr-info.eu/art-33-gdpr/)).
  - Child consent age is 13–16 depending on the country ([Art. 8](https://gdpr-info.eu/art-8-gdpr/)).
  - Health data (injuries, medical waivers) is a special category ([Art. 9](https://gdpr-info.eu/art-9-gdpr/)).
  - Transfers outside the EU are restricted ([Art. 44](https://gdpr-info.eu/art-44-gdpr/)).
  - Fines go up to 4% of turnover ([Art. 83](https://gdpr-info.eu/art-83-gdpr/)).
  - `[INFERENCE]` Use a separate EU data region rather than one global database, since Russian localisation and EU transfer rules pull in opposite directions.

---

## 3. Best practices worth copying

1. **One account, many orgs, one switcher, plus deep-context notifications.** Copy PushPress (a push opens the right gym, [FAQ](https://help.pushpress.com/en/articles/3415630-frequently-asked-questions-about-the-members-app-by-pushpress)), Circle (unread badges per community, [help](https://help.circle.so/p/basics/mobile-apps/switching-between-communities-on-the-circle-mobile-app)), SportEasy (a different role per team, [help](https://sporteasy.zendesk.com/hc/en-gb/articles/360007524313-Navigate-from-one-team-to-the-other-iOS-Android-apps)) and 360Player (parents see their children's groups, [help](https://help.360player.com/en/articles/10205630-change-groups)).
2. **Show only "my" clubs; no marketplace by default.** Copy Walla, Arketa and Altegio's Aunio (links in §0, item 10).
3. **Branded app as a paid upsell on the club's own developer account, with the same login working in the container app.** Copy Eversports ([help](https://helpcenter.eversportsmanager.com/your-branded-app-is-coming-in-q1-2025)). Pricing benchmark: $39–$250/mo (Zen Planner $39, PushPress $97, Gymdesk $100, Walla $169, Kajabi $199, Momence $250); in Russia 2 200–5 740 ₽/мес or 40 000 ₽/год (links in §1).
4. **A free tier with a payments take rate.** PushPress Free charges 4.99% + $0.30 ([blog](https://www.pushpress.com/blog/what-does-gym-software-really-cost)); Spond is free and earns on payments ([help](https://help.spond.com/app/en/articles/118091-payments-costs-in-the-spond-app)); Clubworx is free up to 20 members ([pricing](https://www.clubworx.com/pricing-us)). Pricing by active members is the norm: Zen Planner, Gymdesk, Kicksite, Fitbase.
5. **Optional fee pass-through to members.** Copy Zen Planner "Flex Fees", Walla Offset 3.9% and SportEasy's optional tip (links in §1).
6. **Rank criteria and progress visible to the student.** Gymdesk sets promotion criteria by classes, hours, skills or age ([blog](https://gymdesk.com/blog/switch-martial-arts-software)). Kicksite supports custom belt graphics ([help](https://support.kicksite.net/adding-ranks-and-custom-belt-graphics)). PushPress has belt and stripe tracking ([App Store](https://apps.apple.com/us/app/pushpress-members/id1309909578)).
7. **Content gated by rank or programme.** Copy Gymdesk ([features](https://gymdesk.com/features/member-app)).
8. **Async video feedback from coach to student.** Copy CoachNow: annotation, side-by-side comparison, and free for invited students ([App Store](https://apps.apple.com/us/app/coachnow-sports-coaching-app/id596598472)).
9. **Self-serve freeze and cancel.** Its absence is the top complaint about Momence ([App Store](https://apps.apple.com/us/app/momence/id1577856009)).
10. **Private club with an access code.** Copy Mariana Tek ([help](https://support.marianatek.com/en/articles/12860760-can-our-studio-app-be-private)); Spond lets clubs switch codes on and off ([help](https://help.spond.com/club/en/articles/366641-how-to-enable-or-disable-an-invitation-code-group-code-in-spond-club)).
11. **Video protection for paid curriculum.** Copy GetCourse: watermarking, screen-capture blocking, offline downloads ([blog](https://getcourse.ru/blog/1203081)).
12. **Russian payments stack.** ЮKassa, CloudPayments, Т-Банк and СБП, plus a cloud cash register for 54-ФЗ, plus recurring payments (Mobifitness, Fitbase, МойКласс; links in §1.2).

## 4. Gaps in the market ClubSpace can own

1. **The multi-discipline person (BJJ + yoga + gym) with one account.** No one combines:
   - a unified cross-club calendar,
   - a "wallet" of every membership and its remaining visits and freezes,
   - per-club roles,
   - zero-friction join by code, QR or link.

   Russian players need the club to issue credentials or a one-time club pick (МойКласс, Mobifitness), and none offers code or QR join (§1.2). TeamUp forbids joining in the app (§1.1). TeamSnap ONE reviewers complain about per-team calendars for families ([App Store](https://apps.apple.com/us/app/teamsnap-one/id6670517733)).
2. **Curriculum, rank and video in one place, with video tied to the student's rank and the coach's syllabus.** Today this is split across Zen Planner/Gymdesk (rank), BJJ Fanatics (video) and GB Online (network curriculum). Gymdesk + Smoothcomp is the nearest threat ([press](https://gymdesk.com/press/gymdesk-smoothcomp-acquisition)).
3. **Affiliation networks and franchises.** Headquarters publishes the curriculum and grading standards. Affiliates inherit them, and promotions land in a network-wide rank registry. Gracie University (a CTC licence with online access for students, [ICP](https://www.gracieuniversity.com/icp)) and Gracie Barra (a network app, [App Store](https://apps.apple.com/us/app/gracie-barra-online/id1541334460)) prove the demand, but no product links a network curriculum to each academy's attendance and ranks. 10th Planet and Alliance affiliates are being courted by Gymdesk ([10th Planet](https://gymdesk.com/10th-planet-jiu-jitsu), [Alliance](https://gymdesk.com/alliance-jiu-jitsu)).
4. **Coach-first mobile operations.** Staff apps are weak: Arketa Business about 3.1★ ([vibefam](https://vibefam.com/arketa-review-pricing-features-pros-cons-2026/)), 1С coach app 4.2★ ([App Store](https://apps.apple.com/ru/app/%D1%82%D1%80%D0%B5%D0%BD%D0%B5%D1%80-1%D1%81-%D1%84%D0%B8%D1%82%D0%BD%D0%B5%D1%81-%D0%BA%D0%BB%D1%83%D0%B1/id6451408334)). Gap: a coach does attendance, promotions, freezes, payment links and video feedback from the phone, in under 10 seconds per action.
5. **A Russia-ready modern stack.** iOS is unreliable there (YPLACES gone from iOS; Apple payments stopped) and RuStore is mandatory. A PWA-first, RuStore-ready, 152-ФЗ-local product with a multi-club account and 54-ФЗ receipts is an open slot (§2).
6. **Kids and parents.** One parent account with several children across clubs, as 360Player and МойКласс offer only partially ([360Player](https://help.360player.com/en/articles/10205630-change-groups), [Твой Класс](https://tvoyklass.com/)).

## 5. Distribution recommendation (`[INFERENCE]`, based on §2)
1. **Core: one ClubSpace container app** on App Store, Google Play, RuStore (and AppGallery if needed), plus a first-class PWA. Each club appears inside it as a workspace with its own branding (logo and colour). This is the 4.2.6 picker model.
2. **Pro tier: a branded app built from the same codebase with the workspace locked**, published under the club's own developer accounts, with ClubSpace added as Admin. The same login keeps working in the container app.
3. **Payments:**
   - In-person services go through card or acquiring (Stripe outside Russia; ЮKassa / CloudPayments / Т-Банк / СБП plus a cloud cash register in Russia), never IAP.
   - Video bundled in a club membership is granted by the club with no purchase CTA in the app (reader-style).
   - Standalone paid courses are sold on the web. Optionally use IAP outside Russia, a US link-out, and EU alternative payments.

---

## 6. Per-competitor notes (detailed, sourced)

"not found" = searched but not verifiable; [3P] = third-party source; [INF]/[INFERENCE] = analyst inference.

### 6.1 Global gym / martial-arts management

**Mindbody (Playlist)** — https://www.mindbodyonline.com
- **Segment:** fitness, wellness and beauty studios (yoga, Pilates, salons, spas) ([pricing](https://www.mindbodyonline.com/business/pricing)).
- **Core features:** scheduling, POS/payments, booking widgets, reports, marketing, AI front desk ([pricing](https://www.mindbodyonline.com/business/pricing)).
- **Pricing:** from $79/month per location in the US ([Mindbody blog](https://www.mindbodyonline.com/business/education/blog/mindbody-pricing-united-states)); the geo-localized pricing page says "Starting at €99/month per location". All three tiers (Starter, Accelerate, Ultimate) are "Let's talk". The branded app is an add-on on Accelerate and Ultimate only, not available on Starter ([pricing](https://www.mindbodyonline.com/business/pricing)).
- **Multi-org:** one consumer marketplace app. Users set a location, search businesses or classes, and book with one Mindbody account ([App Store](https://apps.apple.com/us/app/mindbody-fitness-wellness/id689501356)). A reviewer reports that each studio keeps its own copy of the client profile (a name change showed at one studio but not the other) ([same listing](https://apps.apple.com/us/app/mindbody-fitness-wellness/id689501356)).
- **App stores:** "Mindbody: Fitness & Wellness", developer MINDBODY Inc. ([listing](https://apps.apple.com/us/app/mindbody-fitness-wellness/id689501356)). Branded apps run under the client's Apple developer account; "you only need one developer account" even for a franchise ([FAQ](https://support.mindbodyonline.com/s/article/Branded-mobile-app-launch-requirements-FAQ)). The client must enroll as an organization ([Learning Center](https://mindbody.exceedlms.com/student/activity/386904-branded-mobile-app-apple-developer-program)) and accept Apple agreement updates ([help](https://support.mindbodyonline.com/s/article/Accepting-updates-to-the-Apple-Developer-License-Agreement?language=en_US)).
- **Payments:** Mindbody Payments, built on Stripe ([Stripe case study](https://stripe.com/customers/mindbody)).
- **Video:** built-in livestream ([FAQ](https://support.mindbodyonline.com/s/article/Live-stream-FAQ?language=en_US)) and an on-demand video library ([help](https://support.mindbodyonline.com/s/article/Video-MVP-Video-sharing-and-live-streaming?language=en_US)).
- **Reviews:** 4.9 from 274K ratings. Reviews complain about bugs and slow support, which tends to send users back to the studio ([App Store](https://apps.apple.com/us/app/mindbody-fitness-wellness/id689501356)). Capterra users mention app glitches and navigation problems ([Capterra](https://www.capterra.com/p/40229/MINDBODY)).
- **Market:** Vista took Mindbody private in 2019; it bought ClassPass with a $500M Sixth Street-led investment ([Multiples](https://multiples.vc/private-comps/classpass)). The parent brand became Playlist on 4 June 2025 ([press](https://www.playlist.com/press/introducing-playlist-next-generation-platform-wellness-experiences)). Playlist and EGYM merged at a $7.5B enterprise value with $785M of new equity ([announcement](https://www.playlist.com/press/playlist-and-egym-announce-agreement-merge-and-785-million-new-equity-investments-bringing), [completion](https://www.playlist.com/press/playlist-and-egym-complete-merger-power-worlds-most-comprehensive-fitness-and-wellness)). Scale: "40k+ studios" ([App Store](https://apps.apple.com/us/app/mindbody-fitness-wellness/id689501356)), "3M+ monthly shoppers" ([pricing](https://www.mindbodyonline.com/business/pricing)).

**Glofox (ABC Fitness)** — https://www.glofox.com
- **Segment:** boutique studios, gyms, franchises; customers include F45, Club Pilates and Carpe Diem BJJ ([plans](https://www.glofox.com/plans/)).
- **Core features:** booking, billing, payroll, reports, community content, staff app ([plans](https://www.glofox.com/plans/)).
- **Pricing:** "starting at $99 per month"; Essential, Boost and Elite are quote-only. The custom branded app is an add-on on Essential and Boost and included in Elite ([plans](https://www.glofox.com/plans/)).
- **Multi-org:** members download the Glofox Member App, enter a location and search for the studio name ([help](https://support.glofox.com/hc/en-us/articles/46466949130900-An-Overview-of-the-Member-App-and-Standalone-App)). A 2020 update made it easier to create an account at a new studio ([App Store](https://apps.apple.com/us/app/glofox/id916224471)). The October 2026 refresh lets members search studios by name, city, state or postcode, and lists all locations for chains of 10 or fewer ([help](https://support.glofox.com/hc/en-us/articles/54406173004692-Introducing-the-refreshed-Glofox-Member-App)). Members with roaming memberships pick a studio from a list ([help](https://glofox.zendesk.com/hc/en-us/articles/19483109000209-How-Your-Members-Access-Roaming-Locations)).
- **App stores:** "Glofox", developer Glofox ([listing](https://apps.apple.com/us/app/glofox/id916224471)). The "Standalone App" needs a D-U-N-S number and the client's Apple account; Glofox says it "cannot directly publish your app to our own Apple developer account" ([setup](https://support.glofox.com/hc/en-us/articles/46443858038292-Standalone-App-Requirements-and-Process), [FAQ](https://support.glofox.com/hc/en-us/articles/46443804482196-Frequently-Asked-Questions-about-Your-Standalone-App)).
- **Payments:** Glofox Payments via Stripe (cards and direct debit) ([help](https://support.glofox.com/hc/en-us/articles/46466480893204-How-to-Set-up-Glofox-Payments-Stripe)); Stripe Connect and Terminal ([Stripe](https://stripe.com/customers/glofox)).
- **Video:** livestream and on-demand sessions sold through the normal booking flow, using links or Zoom ([FAQ](https://www.glofox.com/faq/)).
- **Reviews:** 4.5 from 271 ratings. Recent reviews complain about constant bugs and no way for members to reach support ([App Store](https://apps.apple.com/us/app/glofox/id916224471)). Review counts: G2 136, Capterra 306, Trustpilot 286 ([plans](https://www.glofox.com/plans/)).
- **Market:** ABC Fitness (a Thoma Bravo portfolio company) acquired Glofox in August 2022 ([Thoma Bravo](https://www.thomabravo.com/press-releases/abc-fitness-solutions-completes-its-acquisition-of-glofox-paving-the-way-to-create-one-of-the-largest-global-fitness-tech-companies)). Before that it raised $10M from Partech ([Partech](https://partechpartners.com/news/glofox-raises-10m-additional-funding-launches-new-platform-live-streaming-and-demand-content-gyms-and-studios)). The brochure claims 31K clubs, 41M+ members and $11B processed per year across ABC ([brochure](https://www.glofox.com/wp-content/uploads/2026/03/Glofox-Brochure-OOOO.pdf)).

**Zen Planner (Daxko)** — https://www.zenplanner.com
- **Segment:** martial arts (10th Planet, Gracie Barra), CrossFit, studios ([mobile page](https://www.zenplanner.com/products/mobile-app)).
- **Core features:** billing, attendance, belt and skill tracking, POS, member app and staff app ([pricing](https://www.zenplanner.com/pricing/active-member-tiers)).
- **Pricing:** priced by active members. Studio runs $99 (0–45) to $289 (251+). Essentials (with website) is $198–$388; Ultimate (with Engage) is $348–$538. Add-ons: branded app $39/mo, Engage $249/mo, website $99/mo. Month-to-month ([pricing](https://www.zenplanner.com/pricing/active-member-tiers)).
- **Multi-org:** one app; "Go to multiple gyms? Log in to all of your Zen Planner accounts, in one place." Members get their login credentials from the gym ([App Store](https://apps.apple.com/us/app/zen-planner-member-app/id1065000091), [members page](https://zenplanner.com/gym-members)).
- **App stores:** "Zen Planner Member App", developer Daxko LLC ([listing](https://apps.apple.com/us/app/zen-planner-member-app/id1065000091)). Branded app $39/mo; whose developer account it uses: not found.
- **Payments:** Zen Planner Payments, with "Flex Fees" that pass processing surcharges to members and a card reader for $39/mo ([pricing](https://www.zenplanner.com/pricing/active-member-tiers), [guide](https://www.zenplanner.com/blog/guides/automated-billing-and-how-to-set-it-up)). The underlying processor: not found on a primary source.
- **Video:** workout logging via SugarWOD ([mobile page](https://www.zenplanner.com/products/mobile-app)); on-demand video: not found.
- **Reviews:** 4.6 from 7.6K ratings ([App Store](https://apps.apple.com/us/app/zen-planner-member-app/id1065000091)). Capterra lists frequent bugs as a con ([Capterra](https://www.capterra.com/p/134351/Zen-Planner)).
- **Market:** Daxko acquired it in March 2017 ([PRN](https://www.prnewswire.com/news-releases/daxko-acquires-zen-planner-to-become-preeminent-software-provider-in-member-based-health--wellness-industry-300426349.html)). Daxko is backed by GI Partners and Genstar ([Mergr](https://mergr.com/transaction/genstar-capital-acquires-daxko)). "5,000+ fitness businesses" ([mobile page](https://www.zenplanner.com/products/mobile-app)).

**PushPress** — https://www.pushpress.com
- **Segment:** CrossFit, BJJ, Hyrox, yoga, boxing ([customers](https://www.pushpress.com/customers)).
- **Core features:** billing, scheduling, check-in, belt/stripe tracking (app v3.34), workouts (Train), CRM (Grow) ([App Store](https://apps.apple.com/us/app/pushpress-members/id1309909578)).
- **Pricing:** Free $0 at 4.99%+$0.30 card processing; Pro $159 at 2.89%; Max $229 at 2.75%; ACH 0.79%+$0.30. Add-ons: Train $79, Branded App $97, Grow $329 ([PushPress blog](https://www.pushpress.com/blog/what-does-gym-software-really-cost)).
- **Multi-org:** same email at every gym, then tap the gym logo to switch. Push notifications switch to the right gym automatically. The gym switcher is "only available within the Members App and not in the Branded App" ([FAQ](https://help.pushpress.com/en/articles/3415630-frequently-asked-questions-about-the-members-app-by-pushpress)). Kiosk QR sign-up is available ([branded page](https://www.pushpress.com/products/branded-member-app)).
- **App stores:** "PushPress Members", developer PushPress, Inc. ([listing](https://apps.apple.com/us/app/pushpress-members/id1309909578)). Branded app: client's Apple account required, but on Android the club doesn't need its own developer account. Live in 7–10 business days, no setup fee, cancel with 30 days' notice ([branded page](https://www.pushpress.com/products/branded-member-app)).
- **Payments:** Stripe ([blog](https://www.pushpress.com/blog/what-does-gym-software-really-cost)).
- **Video:** Train media library built from YouTube/Vimeo videos attached to movements ([help](https://help.pushpress.com/en/articles/5949787-building-your-media-library-in-train-by-pushpress)).
- **Reviews:** 4.8 from 6.7K ratings; complaints about workout history being hard to find ([App Store](https://apps.apple.com/us/app/pushpress-members/id1309909578)).
- **Market:** $11M Series A led by Altos in 2022 ([PRN](https://www.prnewswire.com/news-releases/pushpress-secures-11-million-in-series-a-funding-led-by-altos-ventures-301607996.html)); $20M Series B in 2024 ([Athletech](https://athletechnews.com/pushpress-secures-20m-for-one-stop-solution-for-gym-owners/)); 5,000+ gyms ([customers](https://www.pushpress.com/customers)).

**Wodify** — https://www.wodify.com
- **Segment:** CrossFit and functional fitness gyms ([App Store](https://apps.apple.com/us/app/wodify/id1563729830)).
- **Core features:** classes, workouts, PR tracking, leaderboards, appointments, payments ([App Store](https://apps.apple.com/us/app/wodify/id1563729830)).
- **Pricing:** Essentials $199/location ($99 promo); Accelerate and Ultimate unpublished. This comes from a competitor's blog ([PushPress blog](https://www.pushpress.com/blog/wodify-pricing)). Branded app $79/mo ([Wodify](https://www.wodify.com/products/branded-app)).
- **Multi-org:** clients of two businesses merge their accounts, then use "Switch Business" in the side menu (or the profile menu on web) ([help](https://help.wodify.com/hc/en-us/articles/360058012434-Switching-Between-your-Businesses-Gyms-etc-)).
- **App stores:** "Wodify", developer Wodify ([listing](https://apps.apple.com/us/app/wodify/id1563729830)). Branded app: client's Apple account with brandedapps@wodify.com added as Admin ([help](https://help.wodify.com/hc/en-us/articles/38961734699799-Granting-Wodify-Access-to-Your-Apple-Developer-Account)).
- **Payments:** Wodify Payments, powered by Stripe ([Wodify](https://www.wodify.com/products/payments)).
- **Video:** not found.
- **Reviews:** 4.9 from 17K ratings; users ask for more configurability ([App Store](https://apps.apple.com/us/app/wodify/id1563729830)).
- **Market:** bootstrapped and owned by the founder ([Two-Brain interview](https://twobrainbusiness.com/two-brain-business-wodify/)).

**Gymdesk** — https://gymdesk.com
- **Segment:** martial arts and independent gyms, yoga, dance ([docs](https://docs.gymdesk.com/en/help/docs/member-portal-access-and-login)).
- **Core features:** billing, ranks, check-in (code or QR), content library, door access ([features](https://docs.gymdesk.com/en/help/docs/member-app-features)).
- **Pricing:** by member count: $75 / $100 / $150 / $200 (up to 250 members). Branded app +$100/mo; each extra location +$50/mo ([Gymdesk blog](https://gymdesk.com/blog/gym-management-software-cost), [comparison](https://gymdesk.com/blog/gymdesk-vs-zen-planner-comparison)).
- **Multi-org:** members log in with email and password ([docs](https://docs.gymdesk.com/en/help/docs/member-portal-access-and-login)). A member-side switch between gyms: not found.
- **App stores:** "Gymdesk - Members App", developer Martial Arts on Rails LLC ([listing](https://apps.apple.com/us/app/gymdesk-members-app/id6443918014)). Branded app needs the club's own organization account ("individual accounts cannot be used"), with apps@gymdesk.com invited ([docs](https://docs.gymdesk.com/en/help/docs/branded-member-app)).
- **Payments:** Gymdesk Payments, 2.9%+$0.30 for cards and 1% for ACH (per a [competitor blog](https://www.pushpress.com/blog/what-does-gym-software-really-cost)). Processor: not found.
- **Video:** content library with access gated by membership, program or rank ([features](https://gymdesk.com/features/member-app)).
- **Reviews:** 3.7 from 46 ratings; complaints about no Face ID and no switching between family members ([App Store](https://apps.apple.com/us/app/gymdesk-members-app/id6443918014)).
- **Market:** $32.5M growth investment from Five Elms ([TinySeed](https://tinyseed.com/latest/tinyseed-backed-gymdesk-has-raised-a-325m-strategic-growth-investment-from-five-elms-capital)). Acquired Smoothcomp, used by 80K+ academies, in October 2026 ([press](https://gymdesk.com/press/gymdesk-smoothcomp-acquisition)).

**Kicksite** — https://kicksite.com
- **Segment:** martial arts schools ([FAQ](https://kicksite.com/faq/)).
- **Core features:** CRM, billing, marketing landing pages, websites ([payments page](https://kicksite.com/payment-processing/)).
- **Pricing:** by active students: $49 (0–25), $99 (26–50), $149 (51–100), $199 (101+); every feature at every tier ([FAQ](https://kicksite.com/faq/)).
- **Multi-org:** each school has its own subdomain login (yourschool.kicksite.net) ([KB](https://kicksite.com/knowledge-base/faq-how-do-i-use-kicksite-as-an-app/)). A cross-school switcher: not found.
- **App stores:** none. The Member Portal is a web app students add to the home screen ([KB](https://kicksite.com/knowledge-base/install-member-portal/)).
- **Payments:** Basys in the US, Stripe internationally ([payments page](https://kicksite.com/payment-processing/)).
- **Video:** not found.
- **Reviews:** not found.
- **Market:** independent; "not beholden to private equity" ([Kicksite](https://kicksite.com/martial-arts-management-software/)).

**Spark Membership** — https://sparkmembership.com
- **Segment:** martial arts first, also dance, gymnastics, yoga ([site](https://sparkmembership.com/)).
- **Core features:** trials, billing, attendance; member app with ranks, curriculum videos and messaging ([App Store](https://apps.apple.com/us/app/spark-member/id1453013929)).
- **Pricing:** $199/mo with an 8-week trial ([site](https://sparkmembership.com/)). Spark Ignite marketing add-on $199/mo ([Gymdesk blog](https://gymdesk.com/blog/spark-membership-software-honest-reviews-and-top-complaints)). Branded app price: not published.
- **Multi-org:** in the free app, students find the school by its 4-digit location ID or from a list. Students who cross-train "can now switch locations without logging out" ([help](https://help.sparkmembership.com/en/articles/5392659-member-app-updates)).
- **App stores:** "Spark Member", developer Spark Membership LLC ([listing](https://apps.apple.com/us/app/spark-member/id1453013929)). Custom white-label apps are uploaded separately and depend on the school's own Apple agreements ([help](https://help.sparkmembership.com/en/articles/5392659-member-app-updates)).
- **Payments:** its flat price assumes processing through Spark ([Gymdesk blog](https://gymdesk.com/blog/martial-arts-crm-software)). Processor: not found.
- **Video:** curriculum videos and documents in the app ([App Store](https://apps.apple.com/us/app/spark-member/id1453013929)).
- **Reviews:** 3.7 from 362 ratings; complaints about forced logouts and update churn ([App Store](https://apps.apple.com/us/app/spark-member/id1453013929)).
- **Market:** funding not found.

**Exercise.com (Daxko)** — https://www.exercise.com
- **Segment:** boutique gyms, trainers, coaches ([Daxko](https://www.daxko.com/news/daxko-broadens-boutique-fitness-market-offering-with-acquisition-of-exercise-com)).
- **Core features:** booking, CRM, workouts, e-commerce, custom apps ([Exercise.com](https://www.exercise.com/platform/custom-branded-apps/)).
- **Pricing:** quote-only; Capterra lists "from $239/mo" ([Capterra](https://www.capterra.com/p/152284/exercise-com/)).
- **Multi-org:** chains choose one app for all locations or separate apps per brand ([multi-location](https://www.exercise.com/platform/multi-location/)). A consumer-side gym switcher: not found.
- **App stores:** generic app "Daxko Exercise", developer Exercise.com LLC ([listing](https://apps.apple.com/us/app/daxko-exercise/id559019054)). Custom apps: the client invites Exercise.com to their App Store Connect ([support](https://www.exercise.com/support/topics/apple-developer-account-setup/)).
- **Payments:** Stripe, including Stripe Tax ([support](https://www.exercise.com/support/set-up-stripe-tax/)).
- **Video:** on-demand library, livestreaming, digital products ([on-demand](https://www.exercise.com/platform/on-demand/), [livestream](https://www.exercise.com/platform/livestreaming/)).
- **Reviews:** 3.3 from 23 ratings ([App Store](https://apps.apple.com/us/app/daxko-exercise/id559019054)).
- **Market:** Daxko acquired it in October 2025; terms not disclosed ([Athletech](https://athletechnews.com/daxko-acquires-exercise-com-boutique-fitness-tech/)).

**Clubworx** — https://www.clubworx.com
- **Segment:** martial arts, gyms, yoga, dance; originated in Australia ([pricing](https://www.clubworx.com/pricing-us)).
- **Core features:** bookings, payments, family accounts, gradings and belts, workout library, shop ([App Store](https://apps.apple.com/us/app/clubworx/id1595530037)).
- **Pricing (US):** Free (≤20 active members), $109 (≤100), $149 (≤250, includes multisite), $169 (unlimited). The custom branded app costs an extra upfront plus ongoing fee ([pricing](https://www.clubworx.com/pricing-us)).
- **Multi-org:** the gym invites members by email to set a password ([help](https://intercom.help/clubworx/en/articles/5870461-inviting-your-members-to-your-mobile-app)); one login covers the whole family ([App Store](https://apps.apple.com/us/app/clubworx/id1595530037)). A switch between different clubs: not found.
- **App stores:** "Clubworx", developer Clubworx ([listing](https://apps.apple.com/us/app/clubworx/id1595530037)). The custom branded app requires the client's Apple developer account ([help](https://intercom.help/clubworx/en/articles/11645216-how-to-create-your-apple-developer-account)).
- **Payments:** Ezidebit in AU/NZ, Stripe or Worldpay in the US, Stripe or GoCardless in the UK ([Clubworx](https://www.clubworx.com/feature-benefits/integrate-with-stripe-ezidebit-integrapay-bluefin/)).
- **Video:** online workout library and online meeting details for classes ([App Store](https://apps.apple.com/us/app/clubworx/id1595530037)).
- **Reviews:** US store shows 1.0 from a single rating ([App Store](https://apps.apple.com/us/app/clubworx/id1595530037)). Other review themes: not found.
- **Market:** not found on a primary source.

### 6.2 Boutique / studio platforms

#### 1. Arketa — [arketa.com](https://www.arketa.com/pricing)
- **Segment:** solo instructors and boutique/wellness studios such as Pilates, yoga, gyms and contrast therapy ([pricing](https://www.arketa.com/pricing.md)).
- **Core features:** scheduling, CRM, memberships and packages, point of sale, payroll, marketing automations, AI chat/phone assistant, on-demand library ([pricing](https://www.arketa.com/pricing.md), [features](https://www.arketa.com/features)).
- **Pricing:**
  - Individual is **$49/mo**, billed annually, plus a **3% transaction fee + Stripe fees** ([pricing](https://www.arketa.com/pricing.md)).
  - The Studio Core, Growth and Suite plans are quote-only. The branded app comes with Suite or as an add-on ([pricing](https://www.arketa.com/pricing.md)).
- **Multiple studios per user:**
  - Clients log in through each studio's website or at checkout ([help](https://help.arketa.com/for-clients/account/login)).
  - Within one brand, the branded app can ask clients to pick a default location ([help](https://help.sutrapro.com/en/articles/9829153-description-of-features-in-general-business-settings)).
  - No consumer app that lists studios across brands. Arketa sells this as a feature: "not a marketplace showing every other studio" ([pricing page](https://www.arketa.com/pricing.md)).
- **App stores:**
  - Each studio gets its own iOS/Android app "published under your name." Arketa builds it and handles the App Store submission, and layout changes go live without store review ([pricing page](https://www.arketa.com/pricing.md)).
  - Whose developer account the app is published from: not found.
  - Staff use the "Arketa Business App" ([App Store](https://apps.apple.com/us/app/arketa-business-app/id6450321424)), rated about 3.1 from 35 ratings ([vibefam](https://vibefam.com/arketa-review-pricing-features-pros-cons-2026/)).
- **Payments:** Stripe (fees "+ Stripe fees") ([pricing](https://www.arketa.com/pricing.md)). Apple Pay checkout inside the branded app ([pricing page](https://www.arketa.com/pricing.md)). In-app purchase: not found.
- **Video:** unlimited on-demand library on every plan. Clients log in once to stream videos and follow courses ([on-demand](https://www.arketa.com/features/on-demand-library)). The Suite plan adds Apple TV and Roku apps ([pricing](https://www.arketa.com/pricing.md)).
- **Reviews:**
  - Capterra **4.3** from 111 reviews; sentiment 83% positive, 12% negative ([capterra.ca](https://www.capterra.ca/software/212718/Arketa)).
  - Complaints include held payouts, slow support and unannounced price increases ([Capterra](https://www.capterra.com/p/212718/Arketa/reviews/), [capterra.in](https://www.capterra.in/software/212718/sutra-fitness)).
- **Funding/market:** **$15M Series A** (June 2025) led by Inspired Capital, with First Round and Y Combinator ([blog](https://www.arketa.com/blog/series-a-fundraise.md)).

#### 2. Momence — [momence.com](https://www.momence.com/pricing)
- **Segment:** independent studios and gyms (yoga, Pilates, wellness/spa) and franchises ([Xplor PR](https://xplor.com/press/momence-joins-clubessential-holdings/)).
- **Core features:** scheduling, payments, communications and marketing, AI lead-to-member automation, consumer app ([Xplor PR](https://xplor.com/press/momence-joins-clubessential-holdings/)).
- **Pricing:**
  - Quote-only ("Let's talk pricing") ([pricing](https://www.momence.com/pricing/)).
  - A third party reports Basic free / Pro **$60/mo** / Custom **$199/mo**, plus a platform fee of **5%** on Basic and **2.5%** on Pro ([pembee](https://www.pembee.app/compare/momence)).
  - The branded app costs **$250/mo** extra ([help](https://help.momence.com/en/articles/15862446-request-a-branded-app-custom-mobile-app)).
- **Multiple studios per user:**
  - One "Momence" consumer app. Custom-plan studios are discoverable: users see nearby studios, can search, and can add more via **Account > App Settings > Add host** ([help](https://help.momence.com/en/articles/12143278-customer-mobile-app-faqs)).
  - Studios on other plans appear in a user's app once the studio adds them as a customer or they make a purchase. Studios share their page URL ([help](https://help.momence.com/en/articles/12143278-customer-mobile-app-faqs)).
  - New web accounts see a QR code that leads to the app download ([help](https://help.momence.com/en/articles/12143278-customer-mobile-app-faqs)).
- **App stores:**
  - Container app "Momence" by **Momence, Inc.** ([App Store](https://apps.apple.com/us/app/momence/id1577856009)).
  - Branded apps are "published under your business name," for example Best Body ([iOS](https://apps.apple.com/us/app/best-body-app/id6473385811)). Customization is limited to logo, name and one colour ([help](https://help.momence.com/en/articles/15862446-request-a-branded-app-custom-mobile-app)).
- **Payments:** a studio FAQ says Momence uses **Stripe** for all card payments ([studio FAQ](https://www.tucsoncoldplunge.com/pages/momence-faqs)). In-app purchase: not found.
- **Video:** on-demand videos inside the app ([App Store](https://apps.apple.com/us/app/momence/id1577856009)). Zoom integration for virtual classes ([help](https://help.momence.com/en/articles/8017873-host-onboarding-for-admins)).
- **Reviews:**
  - App Store **4.9 from 47K ratings**. Reviews mention no self-serve cancel or freeze and payment-error glitches ([App Store](https://apps.apple.com/us/app/momence/id1577856009)).
  - Capterra **3.9 from 76 reviews**. Complaints: support, billing and widget ([vibefam](https://vibefam.com/what-momence-users-actually-say-on-capterra-2026/)).
- **Funding/market:**
  - Y Combinator S20 ([YC](https://www.ycombinator.com/companies/momence)). Acquired by **Clubessential Holdings** in January 2025; 4,500+ businesses at the time ([PR](https://xplor.com/press/momence-joins-clubessential-holdings/)).
  - Clubessential merged into **Xplor** on 2026-03-30 ([Xplor PR](https://xplor.com/press/xplor-technologies-and-clubessential-holdings-launch-unified-global-company-under-xplor-brand/)). Momence and Mariana Tek now share a parent.

#### 3. bsport (Paris/Barcelona) — [bsport.io](https://pro.bsport.io/pricing)
- **Segment:** boutique studios (yoga, Pilates, fitness, dance, martial arts) in Europe, North America and APAC ([media kit](https://pro.bsport.io/en/media-kit), [Athletech](https://athletechnews.com/bsport-raises-e30m-boutique-fitness-software/)).
- **Core features:** booking, payments, marketing suite, staff, on-demand, push notifications, self check-in, AI waitlist filling ([pricing](https://pro.bsport.io/pricing)).
- **Pricing:**
  - Tiers are Start, Build, Engage, Elevate and Scale, all quote-only. There is no free plan; new studios get a free initial period built into the contract ([pricing](https://pro.bsport.io/pricing)).
  - The branded app starts at the Engage tier ([pricing](https://pro.bsport.io/pricing)).
- **Multiple studios per user:**
  - There is a marketplace app, "bsport": "3,000 partner studios" ([App Store](https://apps.apple.com/at/app/bsport/id1356621554?l=en-GB)), or "1M users / 1,200+ partners" ([Play](https://play.google.com/store/apps/details?hl=en_GB&id=com.bsport)).
  - The switching flow itself: not found in help docs.
- **App stores:**
  - Branded apps appear under **bsport's own developer account**, e.g. IKIGAI DUBAI, Garys, Engine Room Training ([Play "More by bsport"](https://play.google.com/store/apps/details?hl=en_GB&id=com.bsport)).
  - The container app's developer is BSPORT ([App Store](https://apps.apple.com/at/app/bsport/id1356621554?l=en-GB)).
- **Payments:**
  - **Stripe Connect**, Terminal and Payment Element. Supports local methods (iDEAL, Bancontact, Alma) and migration of direct-debit mandates ([Stripe case](https://www.stripe.com/us/customers/bsport)).
  - About **$25M/month** in volume; Stripe states it as payment monetisation ([Stripe](https://www.stripe.com/us/customers/bsport)). In-app purchase: not found.
- **Video:** unlimited on-demand and Zoom from the Build tier; virtual/hybrid classes ([pricing](https://pro.bsport.io/pricing)).
- **Reviews:**
  - Capterra **4.4 from 324** ([capterra.co.za](https://www.capterra.co.za/reviews/197172/bsport)). Trustpilot 4/5; complaints about contracts and support ([Trustpilot](https://www.trustpilot.com/review/bsport.io?page=4)).
  - Container app reviews are weak (Austrian App Store 1.0 from 1 rating: "slow app") ([App Store](https://apps.apple.com/at/app/bsport/id1356621554?l=en-GB)).
- **Funding/market:** **€30M Series B** (December 2024), led by Base10 and Octopus. About 2,000 studios, targeting €10M+ ARR at the time; earlier €4M Series A in 2022 ([Athletech](https://athletechnews.com/bsport-raises-e30m-boutique-fitness-software/)). The site now claims 3,500+ studios ([branded app](https://pro.bsport.io/features/branded-app)).

#### 4. Eversports (Vienna) — [eversportsmanager.com](https://www.eversportsmanager.com/en/pricing)
- **Segment:** studios, trainers and ball-sports facilities in the DACH region and Europe ([pricing](https://www.eversportsmanager.com/en/pricing)).
- **Core features:** products and point of sale, schedules, check-in, spot booking, team roles, live classes, video on demand, integrations with aggregators such as ClassPass, Urban Sports Club and Wellhub ([pricing](https://www.eversportsmanager.com/en/pricing)).
- **Pricing:**
  - Priced by bookings per month, billed annually: **Light €49** (up to 49), **Starter €79** (up to 199), **Accelerate €119** (up to 599), **Professional €169** (up to 1,499), **Champion €229** (1,500+).
  - Plus a **€99** one-time setup fee, excluding VAT ([pricing](https://www.eversportsmanager.com/en/pricing)).
  - Reviews also mention a referral commission for new customers who arrive via the marketplace ([Capterra](https://www.capterra.in/reviews/161944/eversports-manager)).
- **Multiple studios per user:** marketplace app "Eversports" (find, book and pay across venues) by Eversport GmbH ([Play](https://play.google.com/store/apps/details?id=at.eversport)). Branded apps let users "log in with their existing Eversports account" ([help](https://helpcenter.eversportsmanager.com/your-branded-app-is-coming-in-q1-2025)).
- **App stores:** container app plus white-label apps (since Q1 2025) **hosted in the studio's own Apple/Google developer accounts**, with Eversports developers given access. Example: Balance Soul Studios ([help](https://helpcenter.eversportsmanager.com/your-branded-app-is-coming-in-q1-2025), [iOS](https://apps.apple.com/us/app/balance-soul-studios/id6737477550)).
- **Payments:** a **Stripe** integration covering card, PayPal, SEPA, Twint, Apple Pay and Google Pay ([pricing](https://www.eversportsmanager.com/en/pricing)). In-app purchase: not found.
- **Video:** live classes and video on demand ([pricing](https://www.eversportsmanager.com/en/pricing)). Video in the branded app is only "planned" ([help](https://helpcenter.eversportsmanager.com/your-branded-app-is-coming-in-q1-2025)).
- **Reviews:**
  - Google Play **3.8 from 746 reviews**. Complaints: notifications, Google Pay, too many clicks ([Play](https://play.google.com/store/apps/details?id=at.eversport)).
  - Capterra **4.8 from 119**. Complaints: marketplace commission, payment fees, exit friction ([capterra.in](https://www.capterra.in/reviews/161944/eversports-manager)).
- **Funding/market:**
  - €5M Series A in 2018 ([Radulovski](https://radulovski.com/blog/eversports-raises-5-million-series-a)).
  - RMEP sold its stake in October 2024 ([RMEP](https://www.rmep.com/news/rmep-successful-sale-of-online-sports-booking-platform-eversports)); Verdane became majority owner in 2024 ([startup.eu](https://www.startup.eu/investments/eversports-0-acquisition-03-2026)).
  - Merged with MATCHi in March 2026, giving 9,000+ venues combined ([startupsacquired](https://www.startupsacquired.com/deals/eversports-acquires-matchi)).

#### 5. Virtuagym (Amsterdam) — [business.virtuagym.com](https://business.virtuagym.com/)
- **Segment:** gyms, studios, personal trainers and chains. Claims 10,000+ businesses and 35M+ consumers in 80+ countries ([site](https://business.virtuagym.com/)).
- **Core features:** memberships and billing, scheduling, coaching (workouts and nutrition, AI coach), community and challenges, multi-club management ([site](https://business.virtuagym.com/), [multi-club](https://business.virtuagym.com/multi-club-management)).
- **Pricing:**
  - Quote-only; the pricing page redirects to a demo form ([pricing](https://business.virtuagym.com/our-prices)).
  - Third parties estimate about **$19/24/39 per location per month** plus card fees ([coachway](https://coachway.io/articles/virtuagym-review/)).
- **Multiple studios per user:**
  - Within one operator: "Club Finder for multi-club access with integrated customer app" ([multi-club](https://business.virtuagym.com/multi-club-management)), and one member profile across clubs in the same portal ([Hub](https://business.virtuagym.com/virtuagym-hub/)).
  - Joining a club: web portals offer "Use code to get started" ([club portal](https://onlinefit.virtuagym.com/signin)).
  - Switching between different operators' clubs: not found.
- **App stores:**
  - Generic app "Virtuagym: Fitness & Workouts" by Virtuagym B.V. ([App Store](https://apps.apple.com/us/app/virtuagym-fitness-workouts/id808207399)).
  - White-label apps; Virtuagym "will support you through your Apple Developer Account" ([custom app](https://business.virtuagym.com/custom-mobile-app/)). Example: "Switch" ([Play](https://play.google.com/store/apps/details?id=digifit.android.virtuagym.pro.switchakkrum&hl=en_US)).
- **Payments:** "Virtuagym Pay" ([support](https://support.virtuagym.com/s/article/Virtuagym-Pay-Portal-setup?language=en_US)), with PayPal, Paysafe, Mollie, SEPA and GoCardless ([blog](https://business.virtuagym.com/blog/how-do-you-restart-the-billing-process/), [Mollie](https://www.mollie.com/integrations/virtuagym)). In-app purchase: not found.
- **Video:** integrated video-workout platform ([AFS](https://member.afsfitness.com/content/virtuagym-launches-new-video-workout-platform-%C2%A0)).
- **Reviews:** App Store **4.8 from 8K ratings** ([App Store](https://apps.apple.com/us/app/virtuagym-fitness-workouts/id808207399?see-all=reviews&platform=iphone)); GetApp **3.8 from 265** ([GetApp](https://www.getapp.com/recreation-wellness-software/a/virtuagym/)); G2 **4.4 from 55** ([G2](https://www.g2.com/sellers/virtuagym)).
- **Funding/market:** about **$13.4M** total over 5 rounds ([Tracxn](https://tracxn.com/d/companies/virtuagym/__U2VVXhZxYqgvzV3YNCPfh1gDsSDMvAHmcqER7d-2mDA)); **€3M** from Icecat ([HCM](https://www.healthclubmanagement.co.uk/health-club-management-news/Virtuagym-raises-3m-investment-to-fuel-innovation-in-health-and-fitness-technology/349459)).

#### 6. TeamUp (London) — [goteamup.com](https://goteamup.com/pricing)
- **Segment:** independent studios, boot camps, small gyms, CrossFit boxes ([pricing](https://goteamup.com/pricing)).
- **Core features:** memberships and packs, appointments, courses, waivers, POS, gift cards, family accounts, on-demand programming, AI Business Advisor ([pricing](https://goteamup.com/pricing)).
- **Pricing:**
  - Priced by active customers, month-to-month, no setup fee: e.g. **$189/mo for 101–200 active customers** ([pricing](https://goteamup.com/pricing)); about $119 for fewer than 100 ([G2](https://www.g2.com/products/teamup/pricing)).
  - Add-ons: branded app **£79/mo**, marketing suite **£89/mo**, Perform (CrossFit/functional) **£79/mo** ([pricing](https://goteamup.com/pricing)).
- **Multiple studios per user (closest match to ClubSpace's model):**
  - **One TeamUp account across any number of businesses**, with all registrations, memberships and payments in one place.
  - In the app: ☰ > Dashboard lists every linked business, and you switch there.
  - Joining a new business is **not possible in the app**. It happens through the business's customer-site URL in a browser, or an **email invite** from the business. Duplicate accounts can be merged ([help](https://support.goteamup.com/en/articles/9327650-connecting-your-customer-account-to-a-new-business)).
- **App stores:** container app "TeamUp Member Booking" by **TeamUp Sports** ([App Store](https://apps.apple.com/gb/app/teamup-member-booking/id6740145491)), plus the paid branded add-on ([pricing](https://goteamup.com/pricing)).
- **Payments:** **Stripe** for cards and **GoCardless** for direct debit; TeamUp takes no fee on top ([help](https://support.goteamup.com/en/articles/9327733-payments-billing-and-revenue-w-video), [guide](https://goteamup.com/resources/how-to-use-teamup-guide)). Stripe Capital is also offered ([help](https://support.goteamup.com/en/articles/12821578-stripe-capital)). In-app purchase: not found.
- **Video:** "On demand programming" in core features; on-demand content in the branded app ([pricing](https://goteamup.com/pricing)).
- **Reviews:**
  - Capterra **4.8 from 341** ([capterra.ie](https://www.capterra.ie/reviews/150357/teamup)).
  - The member app is poorly rated: **1.9 from 62 ratings** on the UK App Store ([App Store](https://apps.apple.com/gb/app/teamup-member-booking/id6740145491)) and **1.8 from 104 reviews** on Google Play, with "log in every time" and removed attendance among complaints ([Play](https://play.google.com/store/apps/details?id=teamup.customer.v2&hl=en_IE)).
- **Funding/market:** founded 2012 ([about](https://goteamup.com/company/about)); **acquired by DaySmart** in September 2022 ([BusinessWire](https://www.businesswire.com/news/home/20220908005168/en/DaySmart-Acquires-TeamUp)).

#### 7. Mariana Tek (Xplor) — [marianatek.com](https://www.marianatek.com/pricing/)
- **Segment:** premium boutique brands, from single locations to global brands (Pilates/Lagree, cycling, barre, boxing) ([pricing](https://www.marianatek.com/pricing/)).
- **Core features:** multi-location, CRM, kiosk check-in, waivers, reporting, gamification; appointments added May 2026 ([pricing](https://www.marianatek.com/pricing/), [PR](https://xplor.com/press/marianatek-appointments/)).
- **Pricing:** Core, Core+Growth and Full Growth Bundle, all quote-only. **A custom-branded iOS/Android app is included from Core** ([pricing](https://www.marianatek.com/pricing/)).
- **Multiple studios per user:**
  - One branded app per studio brand. Studios can make the iOS app **private with an access code** that new sign-ups must enter ([help](https://support.marianatek.com/en/articles/12860760-can-our-studio-app-be-private)).
  - A consumer app spanning studios or a shared cross-brand account: not found. "Express by Mariana Tek" is a check-in app ([App Store](https://apps.apple.com/us/app/express-by-mariana-tek/id1486441585)).
- **App stores:** **the studio's own Apple Developer account** (organization account, DUNS number, $99/yr), with Xplor staff added as admins ([help](https://support.marianatek.com/en/articles/6985629-how-do-i-set-up-my-apple-developer-account-grant-access-to-mariana-tek-and-provide-the-api-key)).
- **Payments:** **Stripe** at its standard flat rate, with "nothing on top" ([pricing FAQ](https://www.marianatek.com/pricing/)). In-app purchase: not found.
- **Video:** no native hosting. Livestream and video on demand come through third parties: Zoom/Teams ([help](https://support.marianatek.com/en/articles/3879218-how-do-i-add-a-livestream-or-video-on-demand-class)), Vimeo OTT ([blog](https://www.marianatek.com/blog/livestream-fitness-classes-the-next-best-thing/)), IPSTUDIO ([partner](https://partners.marianatek.com/apps/on-demand-by-ipstudio/)).
- **Reviews:** Capterra **4.0 from 25**; complaints about chat-only support, slow fixes and painful account creation ([capterra.ae](https://www.capterra.ae/reviews/175281/mariana-tek)). G2 **3.3 from 6** ([studiosoftwareadvice](https://studiosoftwareadvice.com/mariana-tek-review-2026-deep-dive/)).
- **Funding/market:** acquired by Xplor in November 2019 ([PitchBook](https://pitchbook.com/profiles/company/182938-15)). Xplor merged with Clubessential in March 2026: 130K+ customers and $47B+ in payments ([PR](https://xplor.com/press/xplor-technologies-and-clubessential-holdings-launch-unified-global-company-under-xplor-brand/)). Entered the UK with 1Rebel ([blog](https://www.marianatek.com/blog/xplor-mariana-tek-expands-into-the-uk-signs-1rebel)).

#### 8. Walla (San Diego) — [hellowalla.com](https://www.hellowalla.com/pricing)
- **Segment:** boutique studios only (yoga, barre, Lagree, HIIT), including franchises ([pricing](https://www.hellowalla.com/pricing)).
- **Core features:** booking and book-a-spot, plans, payroll, marketing suite, WallaPredict churn AI, challenges and streaks ([pricing](https://www.hellowalla.com/pricing), [app](https://www.hellowalla.com/features/branded-app)).
- **Pricing:** from **$299/mo per location**, billed monthly ([pricing](https://www.hellowalla.com/pricing)). A US page lists Core **$320/mo** and Pro **$599/mo** ([US pricing](https://www.hellowalla.com/us/pricing)).
- **Multiple studios per user:**
  - The free "Walla App" uses one login. Tap the **two arrows (top right)** to pick another Walla studio, with no re-signup ([support](https://support.hellowalla.com/clients-and-multiple-walla-studios-walla-support-center)).
  - It shows only studios you belong to, with "never a competitor" ([app page](https://www.hellowalla.com/features/branded-app)). One Play reviewer reports "Can't use multiple Studios" ([Play](https://play.google.com/store/apps/details?id=com.walla.wallaMobile&hl=en_US)).
- **App stores:**
  - The **free Walla app** is published by Walla. The **branded app costs $169/mo** ($149 until 2026-11-01) and is published under the studio's name; Walla handles submission ([app page](https://www.hellowalla.com/features/branded-app)).
  - Walla claims 222 branded apps live and 173K active members using apps ([app page](https://www.hellowalla.com/features/branded-app)).
- **Payments:**
  - Cards migrate "directly to Stripe" ([pricing FAQ](https://www.hellowalla.com/pricing)).
  - Payment methods: cards, ACH, buy-now-pay-later ([manage](https://www.hellowalla.com/solutions/manage)).
  - Financial tools: instant payouts, automated disputes, funding ([payments](https://www.hellowalla.com/walla-payments)). An optional **3.9% "Walla Offset"** passes processing costs to clients ([pricing](https://www.hellowalla.com/pricing)).
  - In-app purchase: not found.
- **Video:** video library, on-demand courses, Zoom on every plan ([pricing](https://www.hellowalla.com/pricing)).
- **Reviews:** Capterra **4.9**, G2 **4.7**, as stated by Walla ([pricing](https://www.hellowalla.com/pricing)). App Store 4.9, also as claimed by Walla ([app page](https://www.hellowalla.com/features/branded-app)).
- **Funding/market:** **$13M** in total ($8M Series A from Industry Ventures plus a $5M seed), July 2022 ([BusinessWire](http://businesswire.com/news/home/20220714005154/en/Walla-Software-Lands-%2413M-Investment-to-Help-Boutique-Fitness-Studios-Adapt-To-A-New-Normal), [American Spa](https://www.americanspa.com/industry-news/walla-software-gets-13-million-investment-growth)). Nothing newer found.

#### 9. Hapana (Sydney) — [hapana.com](https://www.hapana.com/)
- **Segment:** premium multi-site gyms, studios and franchises; "1,500+ businesses" ([blog](https://www.hapana.com/blog/hapana-raises-7-25m-platform-growth)).
- **Core features:** scheduling, billing, staff, marketing and SMS, reporting, white-label member app ([Gymdesk](https://gymdesk.com/blog/best-yoga-studio-software), [branded app](https://www.hapana.com/platform/branded-app)).
- **Pricing:** quote-based. A third party reports **A$199 per fortnight per location** (about A$431/mo) for Basic and $299 per fortnight for Premium ([Gymdesk](https://gymdesk.com/blog/best-yoga-studio-software)).
- **Multiple studios per user:**
  - A generic "Hapana" member app exists but is stale (1K+ downloads, last updated February 2023) ([Play](https://play.google.com/store/apps/details?id=com.onefitstop.client&hl=en_US)).
  - The model is one branded app per brand. Switching across studios: not found.
- **App stores:** branded apps appear under **Hapana's own developer account** (HAPANA AUSTRALIA PTY LTD), e.g. Stir Fit Lab, Mox Gym, FLX Wellness ([Play "More by Hapana"](https://play.google.com/store/apps/details?id=com.onefitstop.client&hl=en_US)).
- **Payments:** **Stripe Connect** since 2016, on track for about A$300M a year ([Stripe](https://stripe.com/en-be/customers/hapana)), or **Ezypay** ([help](https://support.hapana.com/kb/article/779)). In-app purchase: not found.
- **Video:** livestream and on-demand inside the white-label app; videos can be sold as a membership add-on ([site](https://www.hapana.com/), [blog](https://www.hapana.com/blog/offering-on-demand-virtual-fitness-classes)).
- **Reviews:** Capterra **4.5 from 92**. Complaints: buggy back end, slow UI, hidden layered fees, 2-year lock-in; the customer-facing app is praised ([capterra.com.au](https://www.capterra.com.au/reviews/143341/hapana), [Capterra](https://www.capterra.com/p/143341/Hapana/)).
- **Funding/market:** **A$17.3M Series A** (August 2024; OIF Ventures and Bailador; 900+ clubs at the time) ([ausleisure](https://www.ausleisure.com.au/news/sydney-founded-fitness-technology-platform-hapana-raises-17million)). **$7.25M** (January 2026; Microequities) for a platform rebuild ([blog](https://www.hapana.com/blog/hapana-raises-7-25m-platform-growth)).

---

### 6.3 Russia / CIS

#### 1. 1С:Фитнес клуб — [fitness1c.ru](https://www.fitness1c.ru/)
- **Segment:** fitness studios, stretching, yoga, dance and martial-arts schools, kids' sections, up to large sports complexes and franchises ([site menu](https://www.fitness1c.ru/price)).
- **Core features:** schedule and booking, freezing and reissuing memberships, CRM, payroll, 130+ reports, loyalty programme, messenger integrations, access control ([price page](https://www.fitness1c.ru/price)).
- **Pricing:**
  - Cloud plan «Старт» (1 workstation): 2 660 ₽/мес, or 31 920 ₽ for 12 months (−30%).
  - Plan «Бизнес» (2 workstations): 7 210 ₽/мес, or 86 520 ₽ per year.
  - Client app add-on: +5 740 ₽/мес.
  - Boxed licence: from 62 700 ₽ / 112 900 ₽.
  - Support for the boxed version: from 41 100 ₽/год.
  - All from [fitness1c.ru/price](https://www.fitness1c.ru/price).
- **Several clubs per user:** the client app is set up per club with Mobifitness staff, and login is by SMS, WhatsApp or Telegram ([KB](https://www.fitness1c.ru/knowledge-base/integratsii/mobilnoe-prilozhenie/mobilnoe-prilozhenie-klienta)). A network with several locations needs a separate «внешняя система» (external-system link) for each location ([same KB](https://www.fitness1c.ru/knowledge-base/integratsii/mobilnoe-prilozhenie/mobilnoe-prilozhenie-klienta)). In practice the user's path to several clubs is Mobifitness's (see block 2).
- **App stores:** the app is «в вашем фирменном стиле» (in the club's own branding) ([page](https://www.fitness1c.ru/application)). It is delivered through Mobifitness, which publishes in App Store, RuStore and AppGallery ([mobifitness.ru/app](https://mobifitness.ru/app/)). 1С's own coach app «Тренер 1С:Фитнес клуб» is in the App Store with 4.2★ from 141 ratings ([listing](https://apps.apple.com/ru/app/%D1%82%D1%80%D0%B5%D0%BD%D0%B5%D1%80-1%D1%81-%D1%84%D0%B8%D1%82%D0%BD%D0%B5%D1%81-%D0%BA%D0%BB%D1%83%D0%B1/id6451408334)).
- **Payments:**
  - Methods: СБП, payment links, Яндекс Сплит, «более 10» payment integrations ([price](https://www.fitness1c.ru/price), [app page](https://www.fitness1c.ru/application)).
  - Providers documented: ЮKassa ([KB](https://www.fitness1c.ru/knowledge-base/integratsii/platezhnye-servisy/servis-onlayn-platezhey-yukassa-)) and Яндекс Пэй ([docs](https://pay.yandex.ru/docs/ru/cms/1c-fitness)).
  - 54-ФЗ receipts for online payments: Life Pay, Orange Data, CloudKassir ([page](https://www.fitness1c.ru/integrations/fiskalizatsiya-onlayn-platezhey)).
  - No in-house payment product found.
- **Video/content:** not found.
- **Reviews:** 97 reviews on CRMindex ([crmindex](https://crmindex.ru/products/1c_fitness)); review themes not extracted.
- **Market signals:**
  - Claims «№1 в России», 53% of fitness automation (per FitnessData), and 6000+ clients in 25 countries ([about](https://www.fitness1c.ru/about)).
  - In Russia's domestic-software registry since 2016 ([KB footer](https://www.fitness1c.ru/knowledge-base/integratsii/mobilnoe-prilozhenie/mobilnoe-prilozhenie-klienta)).
  - Funding: not found.

#### 2. Mobifitness — [mobifitness.ru](https://mobifitness.ru/)
- **Segment:** fitness clubs, studios, dance and yoga schools, and also beauty salons ([app page](https://mobifitness.ru/app/), [App Store](https://apps.apple.com/ru/app/mobifitness/id986278836)).
- **Core features:** branded client app with schedule, waitlist, freezing and extending memberships, virtual club card, loyalty and referral programmes, push notifications, all locations of a network in one app. Also a CRM and a coach app ([app page](https://mobifitness.ru/app/)).
- **Pricing:**
  - Branded app: «от 2 870 ₽/мес», and payment starts only after the app is published in the stores ([app page](https://mobifitness.ru/app/)).
  - CRM plans per third-party catalogues: 2 540, 4 340 and 12 240 ₽/мес ([crmindex](https://crmindex.ru/products/mobifitness)). The official price page returned HTTP 500 ([mobifitness.ru/price](https://mobifitness.ru/price/)).
- **Several clubs per user:** a shared app, «Mobifitness», where the user picks Country → City → Club **once**. Each club gets its own design and sections inside it. The listing calls it an aggregator ([App Store](https://apps.apple.com/ru/app/mobifitness/id986278836)). Switching between clubs isn't described; the listing says the choice is made once.
- **App stores — both models:**
  - Shared app on iOS: developer «MOBILNYE TEKHNOLOGII, OOO (MSK)», 4.9★ from 10k ratings ([App Store](https://apps.apple.com/ru/app/mobifitness/id986278836)).
  - Shared app on RuStore: 3.5★, 50k+ installs ([RuStore](https://www.rustore.ru/catalog/app/com.itrack.mobifitnessdemo756171)).
  - Branded apps per club: 967 apps under the «Mobifitness» developer account in RuStore ([RuStore dev](https://www.rustore.ru/catalog/developer/5019d3dd)).
  - Branded apps on Google Play are under developer «Mobifitness» ([GP](https://play.google.com/store/apps/developer?id=Mobifitness)). On iOS they are under «LLC Effective Web Solutions» ([iTunes](https://itunes.apple.com/ru/developer/llc-effective-web-solutions/id680588310)).
  - Also published in Huawei AppGallery ([app page](https://mobifitness.ru/app/)).
- **Payments:**
  - Acquirers: ЮKassa, Life Pay, CloudPayments, Т‑Банк, Сбербанк, Альфа‑Банк, NewPay СБП, PayU, bePaid and TipTopPay (Kazakhstan) ([page](https://mobifitness.ru/online-payment/)).
  - Also recurring payments, СБП and payment links; positioned as 54-ФЗ compliant ([same page](https://mobifitness.ru/online-payment/)).
  - Claims 30 000+ online payments a month through the apps ([app page](https://mobifitness.ru/app/)).
- **Video/content:** a «Видео» tab in the app admin that embeds YouTube or VK videos ([blog](https://mobifitness.ru/blog/pryamaya-svyaz-s-klientami-kak-novosti-video-i-push-uvedomleniya-v-prilozhenii-mobifitness-povyshayu/)). Live classes run through a Zoom integration ([academy](https://academy.mobifitness.ru/)).
- **Reviews:** App Store complaints include the SMS login code not arriving and missing visit history ([reviews](https://apps.apple.com/ru/app/mobifitness/id986278836)).
- **Market signals:**
  - 4 000+ clubs and 1M+ active app users ([app page](https://mobifitness.ru/app/)).
  - Supplies the client app for 1С:Фитнес клуб ([1С KB](https://www.fitness1c.ru/knowledge-base/integratsii/mobilnoe-prilozhenie/mobilnoe-prilozhenie-klienta)).
  - Funding: not found.

#### 3. AppEvent — [appevent.ru/dance](https://appevent.ru/dance)
- **Segment:** fitness, yoga, dance, martial arts, kids' sections, tennis and pools. It is also sold to photo studios, lofts, event agencies and others ([pricing](https://appevent.ru/price)).
- **Core features:** booking widget, memberships, freezing, hall rental, coach app, SMS and push, built-in online cash register ([page](https://appevent.ru/dance)).
- **Pricing:**
  - Branded client app: «от 2 200 руб/мес» ([page](https://appevent.ru/dance)).
  - «Спорт» plans per a third-party catalogue: Lite 1 090 ₽, Optima 3 840 ₽, Profi 3 490 ₽ per month ([picktech](https://picktech.ru/product/appevent-sport/)). The official pricing page loads empty without JavaScript ([appevent.ru/price](https://appevent.ru/price)).
- **Several clubs per user:** a branded app per club; No shared consumer app. There is a demo listing, «AppEvent Fitness» ([GP](https://play.google.com/store/apps/details?hl=ru&id=com.appeventru.fitapp_promo)). Login is by SMS-confirmed phone number ([page](https://appevent.ru/dance)).
- **App stores:**
  - Google Play: branded apps such as «МСК фитнес» and «Даймонд» under developer «AppEvent.ru» (APPEVENT LLC, Rostov-on-Don), packages `com.appeventru.fitapp_<id>` ([GP](https://play.google.com/store/apps/details?hl=ru&id=com.appeventru.fitapp_promo)).
  - iOS: branded apps under the individual developer account «Alexey Likhatskiy» ([Pole DOM](https://apps.apple.com/ru/app/pole-dom/id6470196952)).
  - RuStore: only the admin and scanner apps confirmed ([RuStore](https://www.rustore.ru/catalog/app/com.appeventru.ae_admin)). Branded client apps on RuStore: not found.
- **Payments:** built-in online cash register, «соответствие 54-ФЗ», automatic receipts ([page](https://appevent.ru/dance)). Life Pay integration ([Life Pay KB](https://support.life-pay.ru/ru/knowledge_base/art/716/cat/31/appevent)). Other named acquirers: not found.
- **Video/content:** online classes via Zoom ([appevent.ru/zoom](https://appevent.ru/zoom)).
- **Reviews:** ФСК «Океан» app 1.5★ from 2 ratings ([App Store](https://apps.apple.com/ru/app/%D1%84%D1%81%D0%BA-%D0%BE%D0%BA%D0%B5%D0%B0%D0%BD/id6450016085)). Broader themes: not found.
- **Market signals:** operating company ООО «АппИвент», founded 2016 ([startpack](https://startpack.ru/application/appevent)). Funding and customer count: not found.

#### 4. Fitbase (ФитБейс) — [fitbase.io](https://fitbase.io/)
- **Segment:** fitness studios and clubs; also active in Kazakhstan and Uzbekistan ([fitbase.uz](https://fitbase.uz/app)).
- **Core features:** CRM, schedule, client app, hall rental, coach payroll, recurring payments and subscriptions, chat, BI, API, access-control integrations ([pricing](https://fitbase.io/price)).
- **Pricing:**
  - Plans Lite, Standart and Pro, «от 5 417 ₽/мес».
  - Price depends on the number of active clients (open memberships, frozen ones included) and the term; a yearly term saves up to 46%.
  - Network discounts of 15–40%.
  - Acquiring fee from 3.5% (Lite), 3% (Standart) or 2.7% (Pro); СБП from 1.5%.
  - 7-day trial.
  - All from [fitbase.io/price](https://fitbase.io/price).
- **Several clubs per user:** shared app «Fitbase GO». Its changelog fixes a bug «при смене клуба после регистрации» (when switching clubs after registration), and it offers «одно приложение для всех филиалов» (one app for all branches) ([App Store](https://apps.apple.com/ru/app/fitbase-go/id1535178540)). Branded apps are also sold: «Клиент скачивает приложение клуба, а не приложение сервиса» (the client downloads the club's app, not the platform's) ([fitbase.uz](https://fitbase.uz/app)). Login via the MAX messenger was added in 2026 ([changelog](https://apps.apple.com/ru/app/fitbase-go/id1535178540)).
- **App stores:** all published under Fitbase's own developer accounts.
  - iOS: developer «Fitbase» (© ФИТБЕЙС ООО), e.g. Fitbase GO 4.4★ from 31 ratings, VERTICAL FITNESS, MFIT STUDIO ([App Store](https://apps.apple.com/ru/app/fitbase-go/id1535178540)).
  - RuStore: `io.fitbase.*` packages such as «Свой фитнес» ([RuStore](https://www.rustore.ru/catalog/app/io.fitbase.svoyfit)).
- **Payments:** Russia: ЮKassa and CloudPayments; Kazakhstan: TipTop Pay. 54-ФЗ receipts via CloudKassir or Pay Kassa. In-app payment and payment links ([help](https://help.fitbase.io/article/23889)). Fitbase negotiates special rates with the providers ([ЮKassa help](https://help.fitbase.io/article/29340)).
- **Video/content:** not found.
- **Reviews:** self-reported 4.8 average from 500+ reviews ([pricing](https://fitbase.io/price)); 265 reviews on CRMindex ([crmindex](https://crmindex.ru/products/fitbase)).
- **Market signals:** 1 700+ clubs ([pricing](https://fitbase.io/price)); Skolkovo resident ([fitbase.io/club](https://fitbase.io/club)). Funding: not found.

#### 5. МойКласс (Мой Класс) — [moyklass.com](https://moyklass.com/)
- **Segment:** kids' and education centres, sports clubs, language, dance and coding schools ([GP](https://play.google.com/store/apps/details?hl=ru&id=com.app.moyclass)).
- **Core features:** groups and lessons, attendance, memberships, homework and grades, payroll, lead funnel, VK and website widgets ([help](https://help.moyklass.com/)).
- **Pricing:**
  - Priced by active groups, with unlimited students.
  - PRO version, monthly: 1 279 ₽ (up to 5 groups) to 5 603 ₽ (up to 100 groups).
  - Basic version: from 911 ₽ (5 groups) at the same term; cheaper per month on longer terms (−8% / −15% / −25%).
  - Student app: PRO only, 990 ₽/мес (12-month term), 1 090 ₽ (6 months), 1 190 ₽ (1–3 months), per account.
  - All from [moyklass.com/prices](https://moyklass.com/prices).
  - The free plan was dropped on 1 Oct 2026 ([digest](https://moyklass.com/blog/digest_q3)).
- **Several clubs per user:** one shared app, «Твой Класс». Login is email + password issued by the centre, and access must be enabled by the centre. After login the student sees the centre's name and logo ([help](https://help.moyklass.com/ru/knowledge_base/art/144/cat/20/prilozenie-dlja-uchenikov-tvoj-klass)). One email can hold several students, e.g. a parent's children, and the user picks a student at the top of the screen ([tvoyklass.com](https://tvoyklass.com/)). The same FAQ says this happens when the same email is entered in different attendance-tracking accounts, so it may also cover a person enrolled at several centres. No explicit statement of that ([tvoyklass.com](https://tvoyklass.com/)).
- **App stores:** shared app only; branded per-school apps are not offered, which help explicitly says is «не предусмотрена» ([help](https://help.moyklass.com/ru/knowledge_base/art/144/cat/20/prilozenie-dlja-uchenikov-tvoj-klass)).
  - iOS: «Твой Класс», developer «Artem Kuzvesov», 2.9★ from 46 ratings ([App Store](https://apps.apple.com/ru/app/id1635705813)).
  - Google Play and RuStore: `com.yourclass`; Huawei users get an APK ([help](https://help.moyklass.com/ru/knowledge_base/art/144/cat/20/prilozenie-dlja-uchenikov-tvoj-klass)).
- **Payments:**
  - Acquirers: ЮKassa, Т‑Банк, Сбербанк, Альфа‑Банк, Точка, CloudPayments, Robokassa, PayKeeper, Prodamus, TipTop Pay (Kazakhstan), bePaid (Belarus), and СБП/QR ([help](https://help.moyklass.com/ru/knowledge_base/cat/21/onlajn-platezi-i-kassi)).
  - Cash-register service for 54-ФЗ receipts: КОМТЕТ Касса, connecting АТОЛ, Штрих‑М, Эвотор and МодульКасса ([same](https://help.moyklass.com/ru/knowledge_base/cat/21/onlajn-platezi-i-kassi)).
- **Video/content:** homework and lesson materials, plus an «онлайн-занятия» help section ([help](https://help.moyklass.com/)). No video library found.
- **Reviews:** student app reviews say login fails on iPhone and the app is weak ([App Store](https://apps.apple.com/ru/app/id1635705813)); 52 reviews on CRMindex ([crmindex](https://crmindex.ru/products/moyklass/reviews)).
- **Market signals:** 3000+ schools in 24 countries (third-party citation, [vakas-tools](https://vakas-tools.ru/blog/obzor-crm-moi-klass-kak-platforma-pomogaet-zapuskat-kursy-i-razvivat-onlain-shkoly214/)). Operating company ООО «Мой Класс», Yekaterinburg; in the domestic-software registry since 26 Jan 2026 ([prices footer](https://moyklass.com/prices)). Funding: not found.

#### 6. YCLIENTS (international spin-off: Altegio) — [yclients.ru](https://www.yclients.ru/)
- **Segment:** beauty, barbershops, spa, and also fitness and yoga ([YPLACES](https://yplaces.com/), [payments page](https://www.yclients.ru/online_payments)).
- **Core features:** booking journal, 15+ booking channels, memberships and certificates, loyalty, payroll, inventory, free КММ-сервер (a cash-register connector) with electronic receipts, network management ([pricing](https://www.yclients.ru/info/pricing)).
- **Pricing:**
  - Since 10 Aug 2026 priced in staff tiers: 3–4, 5–8, 9–15, 16–45, 46+; terms of 4, 8 or 12 months ([help](https://support.yclients.com/1011--izmenenie-tarifov-na-licenzii-avgust-2026)).
  - Prices per a third party: 3–4 staff from 1 600 ₽/мес (yearly) or 2 000 ₽ (4-month term); 5–8 staff 3 030 ₽; 9–15 staff 5 440 ₽; 16–45 staff 10 400 ₽ ([aravelle](https://aravelle.ru/skolko-stoit-yclients)).
  - Branded app: 40 000 ₽/год, plus 5 000 ₽/год per extra location, plus a $100/yr Apple developer account ([help](https://support.yclients.com/41-693-366--mobilnoe-prilozhenie-ot-yclients)).
- **Several businesses per user:** one marketplace app, **YPLACES**: «Твои любимые места — в одном приложении», 60 000+ locations, discovery of new places, memberships and cashback across businesses ([yplaces.com](https://yplaces.com/)). A branded app is optional and supports a branch list and map ([help](https://support.yclients.com/41-693-366--mobilnoe-prilozhenie-ot-yclients)).
- **App stores:**
  - YPLACES on iOS: «Сейчас нет» (not available now). iOS users get a PWA and a MAX messenger bot ([yplaces.com](https://yplaces.com/), [yplaces.yclients.com](https://yplaces.yclients.com/)); the old App Store URL now returns 404 ([link](https://apps.apple.com/ru/app/yplaces-%D0%BE%D0%BD%D0%BB%D0%B0%D0%B9%D0%BD-%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C/id6448745076)).
  - YPLACES on Android: Google Play 4.9★ from 64.3k reviews, 1M+ installs ([GP](https://play.google.com/store/apps/details?hl=ru&id=com.yclients.yplaces)); also RuStore and AppGallery.
  - Branded apps: under YCLIENTS's own developer accounts on App Store and Google Play ([help](https://support.yclients.com/41-693-366--mobilnoe-prilozhenie-ot-yclients)); 12 YCLIENTS apps in RuStore ([RuStore](https://www.rustore.ru/catalog/developer/5ff74c45)).
- **Payments:** partners ЮKassa, Т‑Банк, Яндекс Пэй, bePaid; СБП from 0.4% / 0.7%; card-on-file autopayment in YPLACES; «Подели» instalments; QR payments; tap-to-pay on a phone; terminal integrations with Эвотор, АТОЛ, МодульКасса, LIFE PAY ([page](https://www.yclients.ru/online_payments)).
- **Video/content:** not found.
- **Reviews:** RuStore business app 4.4★ from 655 ratings ([RuStore](https://www.rustore.ru/catalog/app/apps.yclients1)).
- **Market signals:**
  - «55 000 компаний» ([payments meta](https://www.yclients.ru/online_payments)).
  - VK bought 100% in Dec 2023 ([AIN/Interfax](https://en.ain.ua/2023/12/26/russias-vk-acquires-yclients-operates-in-ukraine-altegio/)).
- **Altegio** ([alteg.io](https://alteg.io/en/about/)):
  - Spun out 2022–23 from YCLIENTS source code; says ties to YCLIENTS are severed. 13 000+ businesses, GMV $143M (May 2026).
  - Payments: Stripe and Adyen (EU) with Apple Pay and Google Pay ([about](https://alteg.io/en/info/about)).
  - Its consumer app **Aunio** lets users book only at businesses they have visited before — a deliberate anti-marketplace design ([press release](https://websummit.com/wp-media/2024/11/Altegio-Press-Release.pdf)).
  - Pricing is flat by team size with 0% booking commission ([pricing](https://alteg.io/en/pricing)).

---

### 6.4 Courses, community, video, martial-arts content, rank trackers

#### Course, community and video platforms

#### Kajabi — https://kajabi.com
- **Segment:** Creators and experts selling courses, coaching, communities and podcasts.
- **Core features:** Courses, cohorts, community, email, funnels, websites, Kajabi Payments, branded app ([pricing](https://www.kajabi.com/pricing)).
- **Pricing:** From Jan 13, 2026: Basic $179, Growth $249, Pro $499 per month; annual billing $143 / $199 / $399 per month [3P] ([ddiy](https://ddiy.co/kajabi-review/)). Kajabi announced the increase itself ([Kajabi](https://kajabi.com/updates/2025-pricing-updates)).
  - Branded app: included in Pro, otherwise a **$199/mo** add-on ([FAQ](https://help.kajabi.com/articles/mobile-apps/branded-app/kajabi-branded-app-faqs)).
- **Multi-org:** The free Kajabi app adds every site tied to your email. You switch from the "Sites" menu and can attach several emails ([help](https://help.kajabi.com/en/articles/17300001-log-in-to-a-kajabi-mobile-app)).
- **App-store strategy:**
  - Container app "Kajabi" by Kajabi, LLC ([App Store](https://apps.apple.com/us/app/kajabi/id1485646310)).
  - The branded app is published under the creator's own Apple/Google accounts, takes 6–8 weeks to launch, and allows one app per account ([FAQ](https://help.kajabi.com/articles/mobile-apps/branded-app/kajabi-branded-app-faqs)).
- **Payments:**
  - Kajabi Payments: 2.9% / 2.8% / 2.7% + $0.30 (US); a 2% / 1% / 0.5% surcharge applies when using a third-party processor ([pricing](https://www.kajabi.com/pricing)).
  - The branded app sells courses and community via **Apple/Google IAP** (15–30% fee, fixed price tiers, offers can't be repriced). Kajabi also suggests "Links" to web offers for higher-priced items ([FAQ](https://help.kajabi.com/articles/mobile-apps/branded-app/kajabi-branded-app-faqs)).
- **Video/content:** Evergreen and cohort courses, podcasts, video transcriptions and translations ([pricing](https://www.kajabi.com/pricing)).
- **Reviews:** App 4.3★ (7.4K) ([App Store](https://apps.apple.com/us/app/kajabi/id1485646310?see-all=reviews)). G2 4.1 (93) ([G2](https://www.g2.com/products/kajabi-kajabi/reviews)). App complaints: freezing and playback bugs [3P summary].
- **Funding/market:**
  - $550M raised at a $2B+ valuation, led by Tiger Global (May 2021) ([PR](https://www.wfmz.com/news/pr_newswire/pr_newswire_technology/kajabi-raises-550-million-and-garners-valuation-over-2-billion-with-growth-financing-led-by/article_e5722f82-ad30-5250-8115-90503cf521ff.html)).
  - Creators have earned $10B+ cumulatively ([BusinessWire](https://www.businesswire.com/news/home/20250806424975/en/$10B-in-Creator-Revenue-and-Climbing-Kajabi-Creators-Are-Achieving-Long-Term-Financial-Success)).

#### Teachable — https://www.teachable.com
- **Segment:** Solo course creators.
- **Core features:** Courses, coaching, downloads, memberships, Teachable Payments ([pricing](https://www.teachable.com/pricing)).
- **Pricing:**
  - Starter $39/mo ($29 billed annually) with a **7.5% transaction fee**.
  - Builder $89 ($69 annually) and Growth $189 ($139 annually), both 0% fee.
  - Custom plan on request ([pricing](https://www.teachable.com/pricing)).
- **Multi-org:** A single "Teachable online courses" app. Students "navigate… between… multiple schools" ([creator guide](https://support.teachable.com/en/articles/11682448-teachable-ios-app-guide-for-creators)).
- **App-store strategy:** Container app only, by developer "Teachable" ([App Store](https://apps.apple.com/us/app/teachable-online-courses/id1177062376)). Branded app: not found.
- **Payments:** Own Teachable Payments ([page](https://www.teachable.com/payments)). The app listing shows no IAP. Version 3.8.13 added a "Discover" tab for **US-based students** to browse and enroll ([App Store](https://apps.apple.com/us/app/teachable-online-courses/id1177062376)) — [INF] likely a US link-out.
- **Video/content:** Courses with offline download inside the app. The app does **not** support memberships, community or coaching ([guide](https://support.teachable.com/en/articles/11682448-teachable-ios-app-guide-for-creators)).
- **Reviews:** App 4.6★ (9.4K). One review quotes support (July 2022) saying Teachable "shift[ed] focus away from the iOS app" ([App Store](https://apps.apple.com/us/app/teachable-online-courses/id1177062376)). G2 3.9 [3P] ([teachfloor](https://www.teachfloor.com/blog/best-mighty-networks-alternatives)).
- **Funding/market:** Acquired by Hotmart for about $250M in 2020 ([PitchBook](https://pitchbook.com/newsletter/hotmart-pays-250m-for-edtech-startup)).

#### Thinkific — https://www.thinkific.com
- **Segment:** Training academies, B2B and customer education.
- **Core features:** Courses, live cohorts, communities, certificates, B2B group orders, SSO/SCORM on Plus ([plans](https://www.thinkific.com/blog/which-thinkific-plan-for-you)).
- **Pricing:** Start $82, Grow $164, Expand $374 per month billed annually ($109 / $219 / $499 billed monthly). Plus is custom.
  - Branded Mobile is included on select Plus contracts; otherwise **$199/mo** ([plans](https://www.thinkific.com/blog/which-thinkific-plan-for-you)).
- **Multi-org:** In the "Thinkific" app you search for a school by name and log in through the browser ([help](https://support.thinkific.com/hc/en-us/articles/11917598555287-Install-and-Navigate-the-Mobile-App)). One reviewer complains there is "no way to easily find" courses from several creators ([App Store](https://apps.apple.com/us/app/thinkific/id1557573471)).
- **App-store strategy:** Container app by "Thinkific" plus Branded Mobile apps under the customer's own accounts ([help](https://support.thinkific.com/hc/en-us/articles/19158621261079-Branded-Mobile-Set-Up-In-App-Purchases-in-the-Apple-App-Store)).
- **Payments:** Thinkific's built-in checkout (TCommerce). The branded app requires IAP:
  - 30% fee, with the 15% small-business programs recommended.
  - $1,000 cap per item.
  - Memberships, trials and monthly payment plans can't be sold via IAP ([IAP help](https://support.thinkific.com/hc/en-us/articles/16261125243159-Sell-Products-in-the-Mobile-App)).
  - The container app says "Browse, purchase… from within the app" ([App Store](https://apps.apple.com/us/app/thinkific/id1557573471)).
- **Video/content:** Courses, Zoom live sessions, events ([plans](https://www.thinkific.com/blog/which-thinkific-plan-for-you)).
- **Reviews:** App **1.8★ (104)**. Themes: resume and progress bugs, crashes, not optimized for iPad ([App Store](https://apps.apple.com/us/app/thinkific/id1557573471)).
- **Funding/market:** Listed on the TSX (THNC). Q2 2026 revenue $18.6M (+3%), ARR $62M ([Investing.com](https://www.investing.com/news/transcripts/earnings-call-transcript-thinkific-posts-modest-q2-2026-revenue-beat-as-upmarket-push-gains-traction-93CH-4839590)).

#### Skool — https://www.skool.com
- **Segment:** Paid communities and coaching groups.
- **Core features:** Community feed, courses, calendar, chat, gamification ([App Store](https://apps.apple.com/us/app/skool-communities/id6447270545)).
- **Pricing:** Hobby $9/mo with a 10% transaction fee; Pro $99/mo with 2.9% ([pricing](https://www.skool.com/pricing)). Pro processing is 2.9% + 30¢ up to $899 ([help](https://help.skool.com/article/86-subscriptions-faq)).
- **Multi-org:** One account. A community switcher at the top of the app lists every joined group, and there is in-app discovery [3P] ([tools4skool](https://tools4skool.com/skool/does-skool-have-an-app)).
- **App-store strategy:** Only the container app "Skool Communities" by Skool.com, Inc. ([App Store](https://apps.apple.com/us/app/skool-communities/id6447270545)). Branded apps: none found.
- **Payments:** Skool's own Stripe-based billing ([help](https://help.skool.com/article/86-subscriptions-faq)). The iOS listing shows "Free" with no IAP label ([App Store](https://apps.apple.com/us/app/skool-communities/id6447270545)) — [INF] reader-style app.
- **Video/content:** Course video lessons and live calls ([pricing](https://www.skool.com/pricing)).
- **Reviews:** App **3.9★ (793)**. Themes: clean and simple, but white-screen and glitch reports ([App Store](https://apps.apple.com/us/app/skool-communities/id6447270545)).
- **Funding/market:** Founded by Sam Ovens. Alex Hormozi took an undisclosed stake in 2024 [3P] ([revenuegeeks](https://revenuegeeks.com/software/skool/who-owns-skool)). Funding rounds: not found.

#### Circle — https://circle.so
- **Segment:** Premium creator and brand communities.
- **Core features:** Community, courses, events, live streams, paywalls, workflows, AI agents ([pricing](https://circle.so/_llms/pricing.md)).
- **Pricing:** Professional $89, Business $199, Scale $419 per month (annual billing), with 2% / 1% / 1% transaction fees. Circle Plus is custom-priced (0.5% fee) and is the **only plan with a branded app** ([pricing](https://circle.so/_llms/pricing.md)).
- **Multi-org:** The "Circle Communities" app has a **"Switch community"** list for all communities under the same email, with unread badges per community ([help](https://help.circle.so/p/basics/mobile-apps/switching-between-communities-on-the-circle-mobile-app)).
- **App-store strategy:** Container app by CircleCo Inc ([App Store](https://apps.apple.com/us/app/circle-communities/id1509651625)). Plus customers get branded iOS/Android apps on their own developer accounts ([help](https://help.circle.so/p/branded-apps/implementation-and-launch/setting-up-app-developer-accounts)).
- **Payments:** Circle paywalls on the web. Branded apps support Apple/Google IAP with **separate app prices**; Apple pays out to the customer directly, and Circle can't issue refunds for Apple purchases ([IAP help](https://help.circle.so/p/branded-apps/in-app-purchases/in-app-purchases-overview)).
- **Video/content:** Live streams with 100–500 attendees depending on plan; courses ([pricing](https://circle.so/_llms/pricing.md)).
- **Reviews:** App 4.9★ (86K) ([App Store](https://apps.apple.com/us/app/circle-communities/id1509651625)). G2 4.5 (~478) [3P] ([teachfloor](https://www.teachfloor.com/blog/best-mighty-networks-alternatives)). Complaint: iPad freezes.
- **Funding/market:** $24.7M Series A led by Tiger Global at a $200M valuation; 4,000+ paying communities in 2021 ([TechCrunch](https://techcrunch.com/2021/12/07/circle-comes-around-again-with-fresh-capital-led-by-tiger-global-for-200m-valuation/)).

#### Mighty Networks / Mighty Pro — https://www.mightynetworks.com
- **Segment:** Community businesses and brands.
- **Core features:** Spaces, courses, events, livestreams, AI host ([pricing](https://www.mightynetworks.com/pricing)).
- **Pricing:** Launch $79, Scale $179, Growth $354 per month (annual billing). Mighty Pro is custom ([pricing](https://www.mightynetworks.com/pricing)).
  - Mighty Pro Basic is shown at **$17,000/yr** as a "representative offer" [3P quoting Mighty's /pro page] ([ezycourse](https://ezycourse.com/blog/mighty-networks-pricing)). Other reports range $28k–$33k [3P].
- **Multi-org:** One "Mighty Networks" app. Sign-in emails a link listing all your networks, or you use "Discover Networks" search. "Switch Networks" sits in the left panel with a "+" to add more. Hidden networks are opened by tapping "View in App" from mobile web ([docs](https://docs.mightynetworks.com/for-hosts/setting-up-your-network/does-mighty-networks-have-an-app)).
- **App-store strategy:** Container app by Mighty Networks ([App Store](https://apps.apple.com/us/app/mighty-networks/id1081683081)). Branded apps only on Mighty Pro ([pricing](https://www.mightynetworks.com/pricing)).
- **Payments:**
  - Stripe on the web, with a platform fee of 2% / 1% / 0.5% [3P] ([group.app](https://www.group.app/blog/mighty-networks-review/)).
  - In the shared iOS app, purchases use **Apple IAP at 15%** and hosts can raise the iOS price to compensate ([docs](https://docs.mightynetworks.com/for-hosts/payments-and-access/does-mighty-networks-charge-a-transaction-fee)).
  - Mighty Pro branded-app payouts go straight to the host's Apple account ([docs](https://docs.mightynetworks.com/for-hosts/payments-and-access/how-do-i-get-paid)).
- **Video/content:** Courses, livestreams, events. No offline access ([docs](https://docs.mightynetworks.com/for-hosts/setting-up-your-network/does-mighty-networks-have-an-app)).
- **Reviews:** App 4.8★ (75K). Complaints: feed ordering and missed notifications ([App Store](https://apps.apple.com/us/app/mighty-networks/id1081683081)). G2: 772 reviews ([G2](https://www.g2.com/products/mighty-networks/reviews)).
- **Funding/market:** $50M Series B (2021) ([PR](https://www.prnewswire.com/news-releases/mighty-networks-raises-50m-equity-round-to-build-the-creator-economy-for-all-301276407.html)).

#### Uscreen — https://www.uscreen.tv
- **Segment:** Video-subscription creators (fitness and yoga are typical) running branded OTT services.
- **Core features:** Video-on-demand catalog, native livestreaming, community, branded mobile and TV apps ([plans](https://www.uscreen.tv/plans-comparison/)).
- **Pricing:**
  - Starter $49/mo.
  - Growth $149/mo plus $1.99 per subscriber.
  - App Essentials $449/mo (annual) or $499 (monthly) plus $0.99 per subscriber, including iOS + Android apps.
  - TV apps only on Custom ([plans](https://www.uscreen.tv/plans-comparison/), [Uscreen blog](https://www.uscreen.tv/blog/uscreen-vs-vplayed/)).
  - 5–10% fee on one-time sales.
- **Multi-org:** One branded app per creator. Shared consumer container app: not found.
- **App-store strategy:** Published under the **creator's own Organization developer account**, with Uscreen added as Admin ([help](https://help.uscreen.tv/en/articles/4316143-create-an-apple-developer-account)).
- **Payments:** Web store plus app-store subscriptions linked to plans. Apple fixes the price tiers and trial lengths. Uscreen warns that pricing in-app higher than web "can result in app store rejection" ([IAP help](https://help.uscreen.tv/en/articles/6194316-subscription-pricing-free-trials-for-in-app-purchases)).
- **Video/content:** VOD, live streams auto-recorded to VOD, Roku, Fire TV and Apple TV ([plans](https://www.uscreen.tv/plans-comparison/)).
- **Reviews:** G2 4.8 per Uscreen's own blog (self-reported) ([Uscreen](https://www.uscreen.tv/blog/video-subscription-learning-platforms/)). App ratings: not applicable, since apps are per creator.
- **Funding/market:** Bootstrapped for 10 years, then a **$150M growth investment from PSG (2025)** ([about](https://www.uscreen.tv/about-us/)).

#### Patreon — https://www.patreon.com
- **Segment:** Creators selling memberships and one-off products to fans.
- **Core features:** Tiers, posts, chats, livestreams, shop ([App Store](https://apps.apple.com/us/app/patreon/id1044456188)).
- **Pricing:** Flat 10% platform fee for pages created after Aug 4, 2025, plus processing; legacy 5% / 8% / 12% tiers are grandfathered [3P] ([casrai](https://casrai.org/guides/patreon-pricing)).
- **Multi-org:** One consumer app. Fans follow and join many creators in one feed ([App Store](https://apps.apple.com/us/app/patreon/id1044456188)).
- **App-store strategy:** One container app by "Patreon" with IAP ([App Store](https://apps.apple.com/us/app/patreon/id1044456188)).
- **Payments and the Apple IAP dispute:**
  - Apple "reimposed" its rule that IAP only works with subscription billing ([Patreon post](https://www.patreon.com/PatreonforCreators/posts/apple-has-its-on-148395613)).
  - All creators had to switch to subscription billing by **Nov 1, 2026**, or Apple could pull the app ([FAQ](https://support.patreon.com/hc/en-us/articles/28801582599181-Migrating-to-subscription-billing-FAQ)).
  - The iOS price is automatically raised about 43% to offset Apple's 30% (15% after one year).
  - Apple payouts are held up to 75 days.
  - **US fans can choose web checkout; non-US fans must use IAP** ([FAQ](https://support.patreon.com/hc/en-us/articles/28801582599181-Migrating-to-subscription-billing-FAQ)).
  - Web checkout became the US default in May 2025, and Apple then made Patreon move it to an external browser ([TechCrunch](https://techcrunch.com/2025/05/06/patreons-app-can-now-accept-web-payments-after-u-s-app-store-changes/)).
- **Video/content:** Video posts, livestreams, community chats ([App Store](https://apps.apple.com/us/app/patreon/id1044456188)).
- **Reviews:** App 4.9★ (581K). Complaint: the algorithmic home feed ([App Store](https://apps.apple.com/us/app/patreon/id1044456188)).
- **Funding/market:** $155M Series F at a $4B valuation (2021) ([Tubefilter](https://www.tubefilter.com/2021/04/07/patreon-4-billion-dollars-funding-round/)).

#### GetCourse (Russia) — https://getcourse.ru
- **Segment:** Russian online schools, including the "health and fitness" niche.
- **Core features:** Courses ("trainings"), homework, CRM, mailings, chats, file storage and video hosting ([prices](https://getcourse.ru/prices)).
- **Pricing:** Priced by active users, from **Start: 1,000 users, 5,900 ₽/mo** up to **S400: 400,000 users, 145,000 ₽/mo**. Prepaying 3 or 6 months saves up to 20% / 35% ([prices](https://getcourse.ru/prices)). The MobilePro add-on adds a surcharge [3P] ([sedov.link](https://sedov.link/blog/1093167)).
- **Multi-org:** One "GetCourse" app. Every school tied to your email appears under "Настроить аккаунты" (account settings). **QR login can't switch between schools** ([blog](https://getcourse.ru/blog/1203081), [blog](https://getcourse.ru/blog/632059)).
- **App-store strategy:** Container app "GetCourse" by **GETCOURSE KAZAKHSTAN, TOO**, also on RuStore ([App Store](https://apps.apple.com/ru/app/getcourse/id1438208045), [blog](https://getcourse.ru/blog/1019460)). Branded per-school app: not found.
- **Payments:** Own "Get Модуль" (GetCourse Pay): ≤3.5% for Russian cards and SBP, 10% for foreign cards, online receipt register (касса) included ([GetCourse Pay](https://getcourse.ru/getcoursepay)). Third-party processors carry no GetCourse fee ([blog](https://getcourse.ru/blog/276150)). The listing is labelled "In-app purchases"; what is sold via IAP: not found.
- **Video/content:** Watermarked hosting, screen-capture blocking, app-only viewing option, offline downloads ([blog](https://getcourse.ru/blog/1203081)).
- **Reviews:** App **4.9★ (243K ratings)**. Complaints: glitches, no iPad version ([App Store](https://apps.apple.com/ru/app/getcourse/id1438208045)).
- **Market:** School revenue on the platform was 158B ₽ in 2025 (down about 6%), of which 24.5B ₽ was health and fitness ([GetCourse](https://getcourse.ru/marketing-blog/1198607/year2025)). 19k+ schools [3P] ([knife.media](https://knife.media/issledovanie-rejting-samyh-populyarnyh-napravlenij-v-onlajn-obuchenii-za-2025-god/)).

---

#### Martial-arts content and curriculum

#### BJJ Fanatics — https://bjjfanatics.com
- **Segment:** BJJ practitioners buying instructionals.
- **Core features:** Instructional store plus a playback app with offline downloads, chapters and bookmarks ([site](https://bjjfanatics.com/)).
- **Pricing:** Per-instructional prices; Gordon Ryan titles run about $349 [3P]. The Gordon Ryan All-Access bundle is about $12,000 [3P] ([bjjdoc](https://bjjdoc.com/2026/06/30/a-bundle-of-gordon-ryans-instructionals-is-for-sale-for-just-12000-and-it-doesnt-even-include-future-releases/)).
- **Multi-org:** Not applicable (single brand).
- **App-store strategy:** Own app "BJJ Fanatics" by **Fanatics LLC** ([App Store](https://apps.apple.com/us/app/bjj-fanatics/id1530956257)).
- **Payments:** **Reader-app pattern.** A reviewer says "Can't purchase in app but it links you directly to the website." The listing still carries an IAP label ([App Store](https://apps.apple.com/us/app/bjj-fanatics/id1530956257)).
- **Video/content:** Purchased on-demand courses, downloadable inside the app.
- **Reviews:** 4.9★ (4.5K). Issues: casting, resume position, library glitches ([App Store](https://apps.apple.com/us/app/bjj-fanatics/id1530956257)).
- **Market:** Operated by "Fanatic LLC" ([terms](https://bjjfanatics.com/pages/terms)). About $19.8M in 2025 online sales [3P estimate] ([Grips](https://gripsintelligence.com/insights/retailers/bjjfanatics.com)). Co-founded by Bernardo Faria [3P] ([Wikipedia](https://en.wikipedia.org/wiki/Bernardo_Faria)).

#### Grapplearts — https://www.grapplearts.com
- **Segment:** Self-learners (Stephan Kesting).
- **Core features:** Course packages plus the free "BJJ Master" container app with 9.5h of free content ([app page](https://www.grapplearts.com/grapplearts-bjj-master-app/)).
- **Pricing:** For example, Submission Formula is $97 on sale (regular $147) ([page](https://www.grapplearts.com/the-submission-formula-with-rob-biernacki-and-stephan-kesting/)).
- **Multi-org:** Not applicable.
- **App-store strategy:** Own container app "BJJ Master App by Grapplearts" ([App Store link](https://itunes.apple.com/us/app/bjj-master-app-by-grapplearts/id1308072068)).
- **Payments:** **Apple/Google IAP** for paid modules inside the app ("additional instructional materials as in-app purchases"); web checkout for packages ([app page](https://www.grapplearts.com/grapplearts-bjj-master-app/)).
- **Video/content:** Stream or download.
- **Reviews:** Not found.
- **Funding:** Not found.

#### Gracie University — https://www.gracieuniversity.com
- **Segment:** Self-defense and BJJ beginners, plus licensed academies (Certified Training Centers, CTCs).
- **Core features:** Online curriculum (Gracie Combatives 2.0), video belt testing, Instructor Certification Program (ICP).
- **Pricing:** Gracie Combatives 2.0 is a **one-time $279** with a 30-day refund ([gc2](https://gc2.gracieuniversity.com/)). One CTC charges $155 for an in-person test, sold through Gymdesk ([CTC](https://gracie-jiu-jitsu-south-bend.gymdesk.com/product/test:-gracie-combatives-test/58538)).
- **CTC model:** Academies pay a one-time ICP fee plus a monthly license fee tied to the success of the Gracie University programs. Certified instructors **and their students get free Gracie University online access** ([ICP](https://www.gracieuniversity.com/icp)).
- **Rank:** The Combatives belt can be earned online by video evaluation or in person at a CTC ([gc2](https://gc2.gracieuniversity.com/)). Higher belts require in-person testing at a CTC [3P] ([attacktheback](https://www.attacktheback.com/great-gracie-university-scam/)).
- **Multi-org / app:** Native Gracie University app: not found ([search: no listing]).
- **Payments:** Web checkout ([gc2](https://gc2.gracieuniversity.com/)).
- **Video:** Brightcove-hosted video (player embed seen on the gc2 page) [INF].
- **Reviews:** Criticism over online blue belts ([BJJEE](https://www.bjjee.com/articles/rickson-gracies-statement-on-gracie-university-online-blue-belts/)).
- **Funding:** Not found.

#### Marcelo Garcia — MGinAction — https://www.mginaction.com
- **Segment:** BJJ technique database.
- **Pricing:** Was $25/mo, $250/yr, or $450/yr Deluxe ([register](https://www.mginaction.com/Register.aspx?SubscriptionType=YearlyDeluxe)).
- **Status:** **Closed.** No new members; existing annual memberships run to expiry with no new content ([site](https://www.mginaction.com/)).
- **App:** "MGInAction" app by MGINACTION ONLINE, which required a subscription bought on mginaction.com — a reader-app pattern [3P] ([apkcombo](https://apkcombo.com/mginaction/com.mginaction/)).
- **Funding:** Not found.

#### Gracie Barra Online (GB curriculum) — https://online.graciebarra.com
- **Segment:** Students at 900+ GB schools following the weekly GB lesson plan ([App Store](https://apps.apple.com/us/app/gracie-barra-online/id1541334460)).
- **Pricing:** $24.99/mo or $249.99/yr, 7-day free trial ([GB](https://online.graciebarra.com/pages/annual-training-pass-1)).
- **Multi-org:** Network-level app (one brand, many schools). Per-school linking: not found.
- **App-store strategy:** "Gracie Barra Online" by GRACIE BARRA JIU JITSU GLOBAL INC, on iPhone, iPad, Apple TV and Watch ([App Store](https://apps.apple.com/us/app/gracie-barra-online/id1541334460)). A separate "Gracie Barra Institute" app exists for instructors ([App Store](https://apps.apple.com/us/app/gracie-barra-institute/id1641318086)).
- **Payments:** **Apple IAP auto-renewing subscription** ("Subscribe in the app") ([App Store](https://apps.apple.com/us/app/gracie-barra-online/id1541334460)). An Adapty paywall is used [3P] ([adapty](https://adapty.io/paywall-library/gracie-barra-online/)).
- **Video/content:** 20+ months of curriculum programs, live events, training calendar.
- **Reviews:** 5.0★ (9) ([App Store](https://apps.apple.com/us/app/gracie-barra-online/id1541334460)).
- **Funding:** Not found.

#### Affiliation networks (10th Planet, Alliance, others)
- **10th Planet:** Gymdesk markets itself as the platform 10th Planet affiliates run on ([Gymdesk](https://gymdesk.com/10th-planet-jiu-jitsu)). Some affiliates instead ship branded apps through Spark Membership with curriculum, rank and attendance (e.g., 10th Planet San Mateo) ([Google Play](https://play.google.com/store/apps/details?id=com.sparkmembership.planetsm&hl=en_US)).
- **Alliance:** Same Gymdesk pitch to Alliance affiliates ([Gymdesk](https://gymdesk.com/alliance-jiu-jitsu)). Separate web subscription "Alliance Instructionals" ([site](https://www.allianceinstructionals.com/HelpAndAdvice.aspx)).
- **Atos:** "Atos BJJ On Demand" app exists ([App Store](https://apps.apple.com/us/app/atos-bjj-on-demand/id1565927498)).
- **Network-wide curriculum app with per-academy linking** (other than GB Online): not found.

---

#### Belt/rank tracking (gym software and personal apps)

#### Gymdesk — https://gymdesk.com
- **Segment:** Martial arts schools, gyms, yoga studios.
- **Core features:** Billing, scheduling, check-in, ranks and promotions (criteria by classes, hours, skills or age; promotion report; students see progress toward next rank), content library, door access ([Gymdesk](https://gymdesk.com/), [blog](https://gymdesk.com/blog/switch-martial-arts-software)).
- **Pricing:** $75 / $100 / $150 / $200 per month by active members (50 / 100 / 200 / 400), all features included [3P] ([offeringtree](https://www.offeringtree.com/blog/mindbody-vs-gymdesk/)). Branded Member App **$100/mo**, live in 2–4 weeks ([docs](https://docs.gymdesk.com/help/branded-member-app)).
- **Multi-org:** Members log in with the same email and password as the gym's member portal; the doc does not describe a gym switcher ([docs](https://docs.gymdesk.com/en/help/docs/member-portal-access-and-login)). Multi-gym switching: not found.
- **App-store strategy:** "Gymdesk – Members App" container app, or a branded app under the gym's own name ([docs](https://docs.gymdesk.com/en/help/docs/member-portal-access-and-login)).
- **Payments:** Card processing in the member app ([docs](https://docs.gymdesk.com/en/help/docs/member-app-features)). Processor name: not found.
- **Reviews:** App 3.7★ (46) [3P listing snippet] ([App Store](https://apps.apple.com/us/app/gymdesk-members-app/id6443918014)).
- **Funding:** Not found.

#### Zen Planner / Kicksite
- **Zen Planner:** Belt and stripe tracking, time in rank, eligibility flags; all tiers $99–$289/mo [3P] ([class-booking](https://class-booking.com/blog/class-booking-vs-zen-planner-martial-arts), [softwarefinder](https://softwarefinder.com/crm/zenplanner)). Vendor page: [BJJ software](https://zenplanner.com/bjj-gym-software/).
- **Kicksite:** Ranks with custom belt graphics and a "Testing Fee" field ([help](https://support.kicksite.net/adding-ranks-and-custom-belt-graphics)). $49–$199/mo by student count [3P] ([makocrm](https://makocrm.so/blog/kicksite-alternatives)).
- **Multi-org app, IAP, funding:** Not found for either.

#### GrappleOS — https://grappleos.com (closest ClubSpace analog)
- **Segment:** BJJ gyms and athletes. Launched Aug 2026 (v1.0.0, Aug 11).
- **Core features:**
  - Schedule; check-in by GPS, gym QR or athlete QR.
  - Streaks and challenges; journal; Smoothcomp import.
  - **"Manage memberships, waivers, belt progression, and multiple gym affiliations."**
  - Staff view switch.
  ([App Store](https://apps.apple.com/us/app/grappleos/id6795693414))
- **Pricing:** Not found.
- **Multi-org:** One app covering multiple gym affiliations.
- **App-store strategy:** Single app by an individual developer (Alberto Septien).
- **Payments:** Gym connects **its own Stripe**; the listing shows no IAP.
- **Video/content:** Not found.
- **Reviews:** Too few ratings to show.
- **Funding:** Not found.

#### Marune — https://marune.social
- **Segment:** Individual practitioners across BJJ, judo, Muay Thai and other arts.
- **Core features:** Training log, belt and stripe history across arts, competition tracker, technique wiki, social feed ([App Store](https://apps.apple.com/us/app/marune/id1405069801)).
- **Pricing:** Free plus a "Peak" subscription via IAP; price not found.
- **Multi-org:** None (no gym linkage).
- **App-store strategy / developer:** Varsalus, Inc.
- **Reviews:** 4.6★ (96).
- **Funding:** Not found.

#### Other personal BJJ trackers
These are personal logs with belt/stripe tracking and no club admin side:
- MatTime: "Strava for BJJ", links to 50+ gyms ([App Store](https://apps.apple.com/us/app/mattime-bjj-training-journal/id6746372577)).
- BJJNote ([App Store](https://apps.apple.com/us/app/bjjnote-bjj-training-journal/id6746068256)).
- Post Black Belt ([App Store](https://apps.apple.com/us/app/post-black-belt-bjj-journal/id1673061463)).
- BJJ Notes: Pro $9.90/mo, $59.90/yr or $149 lifetime [3P] ([sherpajournal](https://sherpajournal.app/blog/best-app-for-bjj-training)).

---

**Not found or not verifiable:** Gracie University app and video-test fee; Skool's IAP policy from a primary source (switcher and billing details come from third-party sites); Gymdesk multi-gym switching; Zen Planner/Kicksite member-app multi-org handling; GrappleOS pricing; funding for Gymdesk, BJJ Fanatics and Grapplearts.

### 6.5 Team / club communication apps

**1. TeamSnap — [teamsnap.com](https://www.teamsnap.com/teams)**
- **Segment:** US youth and adult amateur teams, clubs and leagues ([site](https://www.teamsnap.com/teams/adult-leagues)).
- **Core features:** schedule, chat, availability, assignments, payments, registration, website builder, drills/practice plans ([features](https://www.teamsnap.com/teams/features)).
- **Pricing:**
  - Free tier is for rosters under 15 and shows ads.
  - Premium is $10.83/mo billed annually or $18.99 monthly; Ultra is $13.75/mo billed annually or $25.99 monthly; both are per team.
  - Clubs pay a quoted price for TeamSnap ONE.
  - Source is a competitor's summary checked 2026-09-30 ([Secondslide](https://go.secondslide.io/teamsnap-pricing/)). Billing is per team, not per account ([help](https://helpme.teamsnap.com/article/133-adding-a-team)).
- **Multiple orgs:** one account holds many teams, and you switch from a "team selection list" in the app.
  - To join a new team you need an invitation; clicking "Join" in the email attaches the team to your existing account ([help](https://helpme.teamsnap.com/article/133-adding-a-team)).
  - Invitations sent to existing accounts from within a team can be auto-accepted (same article).
  - Deferred deep links: not found.
- **App strategy:** two apps from the same developer, TeamSnap, Inc.:
  - Classic "TeamSnap": 4.8 stars, 59K ratings ([App Store](https://apps.apple.com/us/app/teamsnap/id393048976?see-all=reviews&platform=iphone)).
  - "TeamSnap ONE": 4.9 stars, 17K ratings, available only "through participating sports clubs and leagues" ([App Store](https://apps.apple.com/us/app/teamsnap-one/id6670517733)).
  - No white-label apps found.
- **Payments:**
  - Invoice processing is 3.25% + $1.50, passed on to the payer, with an on/off toggle ([help](https://helpme.teamsnap.com/article/1359-managing-invoices), [toggle](https://helpme.teamsnap.com/article/1338-creating-invoices)).
  - ACH is supported ([launchnotes](https://teamsnapone.launchnotes.io/announcements/now-available-invoice-members-directly-from-teamsnap-one)).
  - The legacy "Classic Payments" ran on PayPal ([help](https://helpme.teamsnap.com/article/1268-set-up-and-manage-classic-payments)). The current processor is not found.
  - IAP is listed on the App Store ([listing](https://apps.apple.com/us/app/teamsnap-one/id6670517733)).
- **Video:**
  - Livestreaming through an XbotGo partnership is included for all TeamSnap ONE users; replays and highlights need TeamSnap+. The Falcon camera costs $799. GA was 2026-08-25 ([PR](https://www.prnewswire.com/news-releases/teamsnap-and-xbotgos-integrated-live-streaming-experience-is-now-available-to-all-teamsnap-one-users-302857696.html)).
  - Drills come from NFL FLAG, MLS, FC Barcelona and others ([App Store](https://apps.apple.com/us/app/teamsnap-one/id6670517733)).
- **Reviews:**
  - Ad overload and aggressive upsell are the main complaints ([Capterra 4.2/157](https://www.capterra.com/p/123208/TeamSnap/reviews/), [Trustpilot](https://ie.trustpilot.com/review/teamsnap.com)).
  - TeamSnap ONE reviewers say the web portal and team email were removed, and that per-team calendar sync is worse for families with multiple kids ([App Store reviews](https://apps.apple.com/us/app/teamsnap-one/id6670517733)).
- **Funding:**
  - Waud Capital took a majority stake in April 2021 ([PR](https://www.waudcapital.com/en/media/waud-capital-completes-growth-capital-partnership-with-teamsnap)).
  - Acquired MOJO Sports ([blog](https://www.teamsnap.com/blog/announcements/teamsnap-acquires-mojo-sports)).

**2. Spond — [spond.com](https://www.spond.com/en-us)**
- **Segment:** grassroots clubs, teams and groups. Claims "over 12 million" users ([site](https://www.spond.com/en-us)).
- **Core features:** events/RSVP, recurring schedules, chat/polls, payments, guardian accounts, subgroups, lineups ([App Store](https://apps.apple.com/us/app/spond/id755596884)).
- **Pricing:** free; Spond "only make[s] money when… users process their payments through Spond" ([help](https://help.spond.com/app/en/articles/118091-payments-costs-in-the-spond-app)).
- **Multiple orgs:** one app with a Groups list.
  - Groups are always closed, and you can't browse or search them by name.
  - To join: the admin adds you by email or phone, or sends a group code or invite link. In the app it's Groups → "Enter code".
  - Existing users get an in-app notification; new users get email or SMS ([help](https://help.spond.com/app/en/articles/130403-join-a-group)).
  - The public invite page says to "download the Spond app, create an account and enter the group code" ([example](https://spond.com/invite/AXGWO)), i.e. a manual code rather than a deferred deep link.
  - Clubs can turn invitation codes on or off ([Spond Club help](https://help.spond.com/club/en/articles/366641-how-to-enable-or-disable-an-invitation-code-group-code-in-spond-club)).
- **App strategy:** single app from SPOND AS. 4.9 stars, 3.8K US ratings; listed as "Free" with no IAP shown ([App Store](https://apps.apple.com/us/app/spond/id755596884)).
- **Payments:**
  - Processed by Stripe, with the fee charged per product.
  - Standard rates: €0.20 + 2.5% (EUR), £0.20 + 2.5% (GBP), $1.00 + 3.29% (USD/CAD), 2 kr + 2.5% (Nordics).
  - October 2026 promo: €0.10 + 1.25% in DE/FR/IT/Benelux.
  - The group pays by default or can pass the fee to members ([help](https://help.spond.com/app/en/articles/118091-payments-costs-in-the-spond-app)).
  - The "Superdraw" lottery is a fundraising product ([help](https://help.spond.com/app/en/articles/25733-spond-superdraw-faqs-for-admins)).
- **Video:** not found beyond photo/file folders ([App Store](https://apps.apple.com/us/app/spond/id755596884)).
- **Reviews:** praised for calendar sync and RSVP; complaints about calendar spam after leaving a group and no search ([App Store](https://apps.apple.com/us/app/spond/id755596884)).
- **Funding:**
  - Raised NOK 42.5M in July 2026 from existing investors led by Verdane.
  - FY25: revenue NOK 137.6M, loss NOK −35M, after restructuring; no profit expected before 2028 ([NKP/Shifter](https://www.mainsights.io/ma-news/verdane-backed-sportstech-spond-raises-new-capital-from-existing-investors-to-fund-further-growth-investments)).

**3. Heja — [heja.io](https://heja.io/)**
- **Segment:** youth team sports (coaches, parents, players). Mostly US, UK, AU and NZ ([Peak PR](https://peak.capital/heja-raises-investment-peak-capital/)).
- **Core features:** schedule, RSVP, messaging with read receipts, announcements, child safeguarding, media sharing, fundraising webshops ([App Store](https://apps.apple.com/us/app/heja/id1157335714)).
- **Pricing:**
  - Free tier is ad-supported.
  - Team Pro starts "from $8.33" and adds desktop access, payment tracking, attendance stats, unlimited admins, and no ads for coaches.
  - Team Pro Max removes ads for all members ([pricing](https://heja.io/pricing)).
- **Multiple orgs:** one account holds many teams.
  - Switch via You → "Switch team", or tap the team name → "Your Teams" ([help](https://help.heja.io/en/articles/12310118-managing-multiple-teams-on-heja), [help](https://help.heja.io/en/articles/2462391-joining-another-team)).
  - To join: share the team code, or "Invite team members", which shares a link plus the code. Everyone creates their own profile; parents add their children ([help](https://help.heja.io/en/articles/2455365-inviting-members-to-your-team)).
  - "Club Connect" is joined via a shared link ([help](https://help.heja.io/en/articles/14046123-joining-a-club-connect-using-a-shared-link)).
  - Deferred deep links: not found.
- **App strategy:** single app from Heja Sports. 4.8 stars, 24K ratings. Pro is sold through in-app purchase ([App Store](https://apps.apple.com/us/app/heja/id1157335714)).
- **Payments:** only payment tracking (Pro) ([pricing](https://heja.io/pricing)). Fundraising has "no fees" ([App Store](https://apps.apple.com/us/app/heja/id1157335714)). An online acquiring product is not found.
- **Video:** photo/video sharing in team posts only ([App Store](https://apps.apple.com/us/app/heja/id1157335714)).
- **Reviews:** easy invites and multi-team handling are praised. Complaints about grainy media and backlash when calendar sync was briefly paywalled ([App Store](https://apps.apple.com/us/app/heja/id1157335714)).
- **Funding:** $4.2M seed (Peak) in 2021, $7M raised in total. 140K teams and 1M+ users in 2021 ([Peak](https://peak.capital/heja-raises-investment-peak-capital/)); now claims 235K teams and 1.8M users ([App Store](https://apps.apple.com/us/app/heja/id1157335714)).

**4. SportEasy — [sporteasy.net](https://www.sporteasy.net/en/clubs/plans/)**
- **Segment:** French and European amateur teams and clubs ([Badgie comparison](https://www.badgie.com/compare/sporteasy)).
- **Core features:** schedule, availability, lineups, stats, messaging, fee collection, club multi-team calendar and roster, newsletters, sponsorship ads ([plans](https://www.sporteasy.net/en/clubs/plans/)).
- **Pricing:**
  - Club Classic: €0.45/member/mo monthly, or €0.33/member/mo (€3.96/yr) billed annually.
  - Sponsors plan: €0.48/member/mo (€5.76/yr), annual only.
  - 30-day trial ([plans](https://www.sporteasy.net/en/clubs/plans/)).
  - The free team plan has ads and is capped at 30 members, per a third-party summary ([StriveOn](https://joinstriveon.com/blog/sports-club-management-software-free)).
- **Multiple orgs:** one app.
  - On iOS, tap the team name at the top (or My profile → "Change team"); on Android, use My profile → "Change team". You can hold different roles in different teams, e.g. parent in one ([help](https://sporteasy.zendesk.com/hc/en-gb/articles/360007524313-Navigate-from-one-team-to-the-other-iOS-Android-apps)).
  - Joining works via email invitation, team code or invite link ([help](https://sporteasy.zendesk.com/hc/en-gb/articles/205545701-Join-a-team-as-a-PLAYER-COACH)).
  - Deferred deep links: not found.
- **App strategy:** single app, "SportEasy – Team management" ([App Store](https://apps.apple.com/bn/app/sporteasy-team-management/id599931266)). Rating not verified.
- **Payments:**
  - Stripe. In EUR the fee is 1.3%, which the club doesn't have to pay: members can leave an optional "tip" to cover it. Other currencies are 4% ([help](https://sporteasy.zendesk.com/hc/en-gb/articles/7517728368786-Collecting-payments-in-and-What-are-costs-for-my-club), [terms](https://www.sporteasy.net/en/terms-of-use/)).
- **Video:** only video file sharing ([plans](https://www.sporteasy.net/en/clubs/plans/)).
- **Reviews:** Capterra 5.0 from 1 review ([Capterra](https://www.capterra.com/p/162745/Sporteasy/)), which is too few to infer themes from.
- **Funding:**
  - €1.3M in 2017 (F3A/Bpifrance) ([Maddyness](https://www.maddyness.com/2017/04/18/sport-sporteasy-leve-1-3-million-euros/)).
  - €5M Series A in 2021 from Seventure and Macif, with a goal of 10M users ([Usine Digitale](https://www.usine-digitale.fr/article/sporteasy-leve-5-millions-d-euros-pour-s-exporter-a-l-international.N1109744)).

**5. Stack Team App — [teamapp.com](https://www.teamapp.com/)**
- **Segment:** community sports clubs and social groups. 7M+ members and 250K clubs in 150+ countries (2021) ([PR](https://www.send2press.com/wire/stack-sports-to-acquire-team-app/)).
- **Core features:** news push, events/RSVP, access groups, parent–child links, chat, surveys, ticket/merch/membership store, free auto-generated website ([Play](https://play.google.com/store/apps/details?hl=en_US&id=com.teamapp.teamapp)).
- **Pricing:**
  - Free to create and use; funded by in-app and website ads.
  - Paid extras: ad removal (per team or per member), sponsor ad replacement, and store transaction fees ([support](https://support.teamapp.com/en/knowledgebase/5-general-faqs/docs/97-cost-of-team-app)).
  - The store fee percentage is not found.
- **Multiple orgs:** "your own app" is really a club space inside one container app.
  - One login gives unlimited teams, listed on the Home Screen; you tap a team to switch.
  - To join: search for the club in the app or on the web, tap "Request to Become a Member", pick access groups, and a club admin approves ([support](https://support.teamapp.com/en/docs/23-player-profiles-feature-summary), [FAQ](https://www.teamapp.com/faqs)).
  - Public "Find My Team" search ([site](https://www.teamapp.com/clubs/search?_list=v1)).
  - Deferred deep links: not found.
- **App strategy:** one listing, "Stack Team App", from Team Mates Pty Ltd (iOS id625607532, [Play](https://play.google.com/store/apps/details?hl=en_US&id=com.teamapp.teamapp)). No per-club publishing.
- **Payments:** the store sells tickets, merch and memberships ([Play](https://play.google.com/store/apps/details?hl=en_US&id=com.teamapp.teamapp)). Processor not found. IAP is listed, likely for ad removal [INFERENCE].
- **Video:** only video posts in news ([Play](https://play.google.com/store/apps/details?hl=en_US&id=com.teamapp.teamapp)).
- **Reviews:** Play 2.8 stars, 21.1K reviews. Complaints: dated UI, intrusive ads including scammy ad links, no desktop calendar ([Play](https://play.google.com/store/apps/details?hl=en_US&id=com.teamapp.teamapp)).
- **Funding:** acquired by Stack Sports in November 2021 ([PR](https://www.send2press.com/wire/stack-sports-to-acquire-team-app/)). Integrated with GameDay under Stack ([GameDay](https://mygameday.app/2022/08/19/gameday-and-stack-team-app-to-join-forces)).

**6. 360Player — [360player.com](https://www.360player.com/en-us)**
- **Segment:** clubs from grassroots to elite academies (Barça Academy, Rafa Nadal Academy, NYCFC); strong in Sweden ([payments page](https://www.360player.com/en-us/management/payments)).
- **Core features:** payments, registrations, communication, scheduling, website, training library, player development, video ([management](https://www.360player.com/en-us/management)).
- **Pricing:** quote-only, priced by member count, modules used and the payment fees for your market ([pricing](https://www.360player.com/en-us/pricing)).
- **Multiple orgs:** one app.
  - A group switcher sits in the mobile header.
  - Your own groups appear first, followed by your connected children's groups; parents see their children's groups without joining them.
  - Calendar, wall and menu all change per group ([help](https://help.360player.com/en/articles/10205630-change-groups)).
  - Invite and deep-link details: not found.
- **App strategy:** single app from 360Player AB. 4.5 stars, 370 US ratings ([App Store](https://apps.apple.com/us/app/360player/id1440982399)).
- **Payments:**
  - Stripe (legacy integration) ([help](https://help.360player.com/en/articles/10175239-connect-stripe-for-payment-processing)).
  - Parents can pay with Swish and Fritidskortet ([pricing FAQ](https://www.360player.com/en-us/pricing)).
  - Features: automatic reminders and retries, installments, and a QR digital membership card.
  - Claims 96% auto-collection across 1,800 clubs ([payments](https://www.360player.com/en-us/management/payments)).
  - Fee percentage is not public.
- **Video:**
  - Embed footage from Veo, Vimeo or YouTube, then clip, annotate with animated drawings, tag players and build playlists ([video](https://www.360player.com/en-us/development/video)).
  - Shared training library ([same page](https://www.360player.com/en-us/development/video)).
- **Reviews:** an aggregator gives 3.4/5 over 499 reviews, citing update prompts and cancellation complaints ([Marlvel](https://marlvel.ai/intel-report/sports/360player)).
- **Funding:** SEK 250M from Five Elms Capital in November 2024 ([press](https://www.360player.com/press/360player-receives-25-million-investment-from-five-elms-capital-to-accelerate-global-expansion-of-sports-management-software)).

**7. Hudl — [hudl.com](https://www.hudl.com/)**
- **Segment:** high school, club, college and pro teams. 160K teams and 6M users (2020) ([PR](https://www.prnewswire.com/news-releases/hudl-the-global-leader-in-sports-performance-analysis-solutions-announces-growth-investment-from-bain-capital-tech-opportunities-301063355.html)).
- **Core features:** video capture, breakdown and stats, livestreaming, recruiting highlights, ticketing, messaging and schedules, fundraising ([club soccer pricing](https://www.hudl.com/pricing/club/soccer)).
- **Pricing (US club soccer, per team per year):**
  - Core: $500, sold only within a club package.
  - Plus: $1,000. Premier: $2,500.
  - Multi-team packages get "discounts up to 50%" ([pricing](https://www.hudl.com/pricing/club/soccer)).
- **Multiple orgs:** one app; tap the avatar to pick a team.
  - Athletes join with invite codes ([support](https://support.hudl.com/s/article/add-team-members-with-invite-codes-hudl-v3?language=en_US); page did not load during research; claim relies on the search snippet).
  - Content is scoped to the team it was created in ([support](https://support.hudl.com/s/article/move-from-one-team-to-another-wyscout?language=en_US)).
  - Deferred deep links: not found.
- **App strategy:** single "Hudl" app from Hudl, Inc. (US). 4.3 stars, 16K ratings, IAP listed. Parents and fans buy tickets and season passes in-app ([App Store](https://apps.apple.com/us/app/hudl/id412223222)).
- **Payments:** ticketing and fundraising exist ([TeamUp PR](https://www.hudl.com/blog/hudl-acquires-teamup-gamified-fundraising)). Processor and fee: not found.
- **Video:** this is the core product: 50–200 hours of storage per tier, AI summaries, analyst breakdowns, smart cameras, livestreaming ([pricing](https://www.hudl.com/pricing/club/soccer)).
- **Reviews:** bugs, mobile-vs-web feature gaps, and anger over youth price increases (from $99 to $400+) ([App Store](https://apps.apple.com/us/app/hudl/id412223222)).
- **Funding and M&A:**
  - Bain Capital Tech Opportunities growth investment in 2020 ([PR](https://www.prnewswire.com/news-releases/hudl-the-global-leader-in-sports-performance-analysis-solutions-announces-growth-investment-from-bain-capital-tech-opportunities-301063355.html)).
  - 18th acquisition was Athletic Data Innovations in October 2025 ([SBJ](https://www.sportsbusinessjournal.com/Articles/2025/10/22/hudl-makes-18th-acquisition-adding-athletic-data-innovations-for-elite-sports-load-management/)).
  - Also Balltime (February 2025) ([BusinessWire](https://www.businesswire.com/news/home/20250206384625/en/Hudl-Expands-Volleyball-Focus-Through-Game-Changing-Acquisition-of-Balltime)), Titan Sports (June 2025) ([blog](https://www.hudl.com/blog/hudl-acquires-titan-sports)), SportContract ([blog](https://www.hudl.com/blog/hudl-acquires-sportcontract)), and TeamUp fundraising (July 2026) ([blog](https://www.hudl.com/blog/hudl-acquires-teamup-gamified-fundraising)).

**8. CoachNow — [coachnow.com](https://coachnow.com/pricing)**
- **Segment:** individual coaches, academies and facilities in 60+ sports, golf-heavy ([news](https://www.manilatimes.net/2024/10/21/tmt-newswire/globenewswire/coachnow-by-golf-genius-announces-new-low-cost-membership-option/1988091)). This is the closest analogue to one-to-one BJJ or yoga coaching.
- **Core features:** video analysis, Spaces/Groups messaging, templates, smart lists, scheduling and billing in the Academy tier ([pricing](https://coachnow.com/pricing)).
- **Pricing:**
  - Analyze: $59/yr or $9.99/mo (5 Spaces, 250 media items).
  - PRO: $499/yr or $49.99/mo.
  - Academy: $899/yr or $89.99/mo.
  - Multi-coach quotes available; 7-day trial ([pricing](https://coachnow.com/pricing)).
- **Multiple orgs:** one app with many Spaces (one-to-one) and Groups.
  - Invites go by email, phone or a private link ([help](https://help.coachnow.io/en/articles/6310530-privacy-settings-controlling-who-sees-your-content), [phone invites](https://help.coachnow.io/en/articles/10525674-how-do-i-invite-athletes-by-phone-number)).
  - Athletes tap "I was invited" and enter a 6-digit code, which works only once ([Academy 101](https://help.coachnow.io/en/articles/10809209-coachnow-academy-101), [accept invite](https://help.coachnow.io/en/articles/3143317-how-to-accept-an-invitation)).
  - Invited athletes use it for free ([help](https://help.coachnow.io/en/articles/361978-what-is-a-space)).
- **App strategy:** single app from Golf Genius Mobile, LLC. 4.9 stars, 13K ratings, with IAP; trials start in-app ([App Store](https://apps.apple.com/us/app/coachnow-sports-coaching-app/id596598472)).
- **Payments:** coach subscriptions via IAP. Academy invoicing and billing for clients runs on Stripe Connect ([pricing](https://coachnow.com/pricing)).
- **Video:**
  - Annotation, AI skeleton tracking and angle detection, voice-overs, CoachCam, side-by-side comparison, MultiCam, 240fps slow motion, cloud library up to 300GB ([App Store](https://apps.apple.com/us/app/coachnow-sports-coaching-app/id596598472), [pricing](https://coachnow.com/pricing)).
  - Coaching courses are included in PRO.
- **Reviews:** strongly positive on async video feedback and on being free for students ([App Store](https://apps.apple.com/us/app/coachnow-sports-coaching-app/id596598472)). Negative themes: not found.
- **Funding:** acquired by Golf Genius in February 2024 ([blog](https://coachnow.com/blog/golf-genius-acquisition)). CoachNow Academy launched in January 2025 ([Golf Genius](https://www.golfgenius.com/resources/news/cnacademyrelease)).
