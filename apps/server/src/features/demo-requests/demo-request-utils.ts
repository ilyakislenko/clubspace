import { escapeHtml } from '../../shared/utils/escape-html'
import type { DemoRequest } from '../../infrastructure/prisma'

// The platform owner's e-mail about a new demo request. Every value came from
// an anonymous form, so each one is escaped.
export const demoRequestEmail = (
    row: DemoRequest,
    consoleUrl: string | null,
): { subject: string; html: string } => {
    const rows: Array<[string, string | null]> = [
        ['Имя', row.name],
        ['Клуб', row.clubName],
        ['Город', row.city],
        ['Телефон / Telegram', row.contact],
        [
            'Учеников',
            row.studentsCount === null ? null : String(row.studentsCount),
        ],
        ['Комментарий', row.comment],
    ]
    const table = rows
        .filter((r): r is [string, string] => Boolean(r[1]))
        .map(
            ([label, value]) =>
                `<tr><td style="padding-right:12px;color:#666">${escapeHtml(label)}</td><td style="white-space:pre-line">${escapeHtml(value)}</td></tr>`,
        )
        .join('')
    return {
        // Subject is a mail header, not HTML: strip line breaks instead.
        subject: `Заявка на демо: ${row.clubName}`.replace(/[\r\n]+/g, ' '),
        html:
            `<p>Новая заявка на демо с сайта ClubSpace.</p>` +
            `<table>${table}</table>` +
            (consoleUrl
                ? `<p><a href="${escapeHtml(consoleUrl)}">Открыть консоль платформы</a></p>`
                : ''),
    }
}
