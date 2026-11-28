// The notice a member accepts in the app before their first «Спросить ИИ по
// видео клуба» question (App Store 5.1.2: explicit permission before anything
// the user types goes to a third-party AI). Kept per user and club as
// AiDataTransferAcceptance evidence under its own edition (the `video-answers-`
// prefix keeps it apart from the owner's chat and token warnings in the same
// table): bump `version` whenever the text changes, and the app asks again.
export const VIDEO_ANSWERS_NOTICE = {
    version: 'video-answers-2026-11-28',
    title: 'Вопрос уйдёт ИИ-сервису',
    text: [
        'Чтобы ответить, ClubSpace отправит ваш вопрос и отрывки расшифровок видео клуба поставщику ИИ-сервиса — третьему лицу, серверы которого, как правило, находятся за пределами России.',
        'Ваше имя, контакты и другие данные профиля не отправляются. Телефон или e-mail, написанные в вопросе, скрываются до отправки.',
        'Ответ собирается только из видео клуба и может ошибаться — проверяйте его по видео. Вопросы видят администраторы клуба в истории изменений.',
    ].join('\n\n'),
} as const
