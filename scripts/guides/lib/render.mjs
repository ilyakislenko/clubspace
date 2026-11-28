// Still images of a guide, drawn by Chromium from HTML: the title and end
// cards, the frame around the recording, each caption (full-frame transparent
// PNGs, overlaid by ffmpeg) and the poster's title strip. The Homebrew ffmpeg
// has no drawtext/libass, and the browser sets Russian text better anyway.
import { chromium } from 'playwright'

export const W = 1920
export const H = 1080

// Where the recording sits inside the 1920×1080 frame, per guide kind. The
// desktop admin is recorded at 1440×900, the phone at 390×844 (2× pixels).
export const LAYOUTS = {
    admin: { x: 128, y: 18, w: 1664, h: 1040, radius: 14 },
    phone: { x: 1140, y: 28, w: 434, h: 940, radius: 40 },
}

const FONT = `-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif`
const BG = 'linear-gradient(135deg, #0b1220 0%, #172036 55%, #1e2a44 100%)'
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const page = (body, { transparent = false } = {}) => `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; font-family: ${FONT};
  background: ${transparent ? 'transparent' : BG}; color: #f8fafc; -webkit-font-smoothing: antialiased; }
.brand { font-size: 30px; font-weight: 600; letter-spacing: .02em; color: #93c5fd; }
.role { display: inline-block; font-size: 30px; font-weight: 600; padding: 8px 20px; border-radius: 999px;
  background: rgba(147,197,253,.14); color: #bfdbfe; }
.cap { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); max-width: 1560px;
  padding: 14px 30px 16px; border-radius: 16px; background: rgba(9,14,28,.88);
  box-shadow: 0 0 0 2px rgba(255,255,255,.08); text-align: center; font-size: 46px; line-height: 1.25;
  font-weight: 600; white-space: nowrap; }
</style></head><body>${body}</body></html>`

export async function openRenderer() {
    const browser = await chromium.launch()
    const p = await browser.newPage({ viewport: { width: W, height: H } })
    const shot = async (html, path, opts) => {
        await p.setContent(page(html, opts), { waitUntil: 'load' })
        await p.screenshot({ path, omitBackground: Boolean(opts?.transparent) })
    }
    return {
        titleCard: (guide, path) =>
            shot(
                `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 160px;gap:36px">
                  <div class="brand">ClubSpace · видеоинструкция</div>
                  <div style="font-size:92px;font-weight:700;line-height:1.08;max-width:1500px">${esc(guide.title)}</div>
                  <div><span class="role">${esc(guide.role)}</span></div>
                </div>`,
                path,
            ),
        endCard: (guide, helpUrl, path) =>
            shot(
                `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:34px;text-align:center">
                  <div style="font-size:88px;font-weight:700">Готово</div>
                  <div style="font-size:44px;color:#cbd5e1;max-width:1400px;line-height:1.3">${esc(guide.outro)}</div>
                  <div style="font-size:34px;color:#93c5fd;margin-top:30px">Все видеоинструкции: ${esc(helpUrl.replace(/^https?:\/\//, ''))}</div>
                </div>`,
                path,
            ),
        // The backdrop with a transparent rounded hole where the recording shows.
        // The phone layout puts the guide's title beside the phone.
        frame: (guide, kind, path) => {
            const l = LAYOUTS[kind]
            const side =
                kind === 'phone'
                    ? `<div style="position:absolute;left:150px;top:0;bottom:0;width:760px;display:flex;flex-direction:column;justify-content:center;gap:28px">
                        <div class="brand">ClubSpace</div>
                        <div style="font-size:64px;font-weight:700;line-height:1.12">${esc(guide.title)}</div>
                        <div><span class="role">${esc(guide.role)}</span></div>
                      </div>`
                    : ''
            // The gradient everywhere except the hole (an SVG mask), and a thin
            // light edge around the hole.
            return shot(
                `<svg width="${W}" height="${H}" style="position:absolute;inset:0">
                   <defs>
                     <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                       <stop offset="0" stop-color="#0b1220"/><stop offset=".55" stop-color="#172036"/><stop offset="1" stop-color="#1e2a44"/>
                     </linearGradient>
                     <mask id="m"><rect width="${W}" height="${H}" fill="#fff"/>
                       <rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${l.radius}" fill="#000"/></mask>
                   </defs>
                   <rect width="${W}" height="${H}" fill="url(#g)" mask="url(#m)"/>
                   <rect x="${l.x - 1.5}" y="${l.y - 1.5}" width="${l.w + 3}" height="${l.h + 3}" rx="${l.radius + 1.5}"
                     fill="none" stroke="rgba(255,255,255,.16)" stroke-width="3"/>
                 </svg>${side}`,
                path,
                { transparent: true },
            )
        },
        caption: (lines, path) =>
            shot(`<div class="cap">${lines.map(esc).join('<br>')}</div>`, path, { transparent: true }),
        posterStrip: (guide, path) =>
            shot(
                `<div style="position:absolute;left:0;right:0;bottom:0;height:420px;padding:0 120px 60px;
                   display:flex;flex-direction:column;justify-content:flex-end;gap:18px;
                   background:linear-gradient(to top, rgba(9,14,28,.97) 0%, rgba(9,14,28,.92) 45%, rgba(9,14,28,0) 100%)">
                  <div class="brand">ClubSpace · ${esc(guide.role)}</div>
                  <div style="font-size:76px;font-weight:700;line-height:1.08">${esc(guide.title)}</div>
                </div>`,
                path,
                { transparent: true },
            ),
        blank: (path) => shot('', path, { transparent: true }),
        close: () => browser.close(),
    }
}
