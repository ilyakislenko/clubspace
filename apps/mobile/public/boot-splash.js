// The boot splash's hand-off, loaded synchronously right after the splash in
// public/index.html. A file rather than an inline <script> so the PWA's
// Content-Security-Policy (deploy/pwa.Caddyfile) can stay `script-src 'self'`.
;(function () {
  // Paint the *chosen* theme, not just the OS one: the app mirrors its
  // resolved background here (see shared/theme-context.tsx) so a member on
  // a dark theme under a light OS doesn't get a white flash on every load.
  try {
    const saved = localStorage.getItem("clubspace.bootBackground")
    // Colour literals only — never a url()/gradient, so a tampered
    // storage entry can't turn the splash into a network request.
    // Mirrors SAFE_COLOR in src/shared/web-boot-theme.ts.
    if (saved && /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s/-]+\))$/i.test(saved)) {
      document.documentElement.style.background = saved
      document.body.style.background = saved
      const el = document.getElementById("boot-splash")
      if (el) el.style.background = saved
    }
  } catch (e) {
    /* storage disabled — fall back to the prefers-color-scheme CSS */
  }
  // Hand off to the app as soon as it renders its first node.
  const splash = document.getElementById("boot-splash")
  const root = document.getElementById("root")
  if (!splash || !root) return
  let done = false
  const hide = function () {
    if (done) return
    done = true
    observer.disconnect()
    splash.classList.add("is-hidden")
    setTimeout(function () {
      splash.remove()
    }, 250)
  }
  const observer = new MutationObserver(function () {
    if (root.childNodes.length > 0) hide()
  })
  observer.observe(root, { childList: true })
  if (root.childNodes.length > 0) hide()
  // Never trap the user behind the splash if the bundle fails to mount.
  setTimeout(hide, 10000)
})()
