# Changelog

All notable changes to Cursor Trail FX are documented here.

---

## [Unreleased] - 2026-05-16

### Security

- **Content Security Policy** — Added strict `Content-Security-Policy` meta tags to both
  `index.html` (overlay window) and `public/settings.html` (settings window).
  Policy: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; connect-src 'none';`

- **Extracted inline script** — Moved the entire settings window JavaScript out of the
  `<script>` block in `settings.html` into a dedicated `public/settings.js` file so the
  strict `script-src 'self'` CSP can take effect without requiring `'unsafe-inline'`.

- **Navigation lock** — Both `mainWindow` and `settingsWindow` now register
  `will-navigate` and `will-redirect` handlers that call `event.preventDefault()`,
  preventing the renderer from being steered to an arbitrary local or remote URL.

- **Tightened `isTrustedSender`** — In production the IPC trust check now verifies the
  sender URL starts with the specific `dist/renderer/` path inside the app bundle,
  rather than accepting any `file://` origin. In dev mode it still trusts only the
  expected Vite dev-server URL.

- **Color field validation** — Added `isHexColor()` to `shared/config.ts`. `mergeConfig`
  now validates `color` and `secondaryColor` against a strict `#rrggbb` format check
  (pure character-code comparison, no regex) and falls back to the default values if
  either field is malformed, preventing dirty data from being persisted to `config.json`.

- **Hotkey field validation** — Added `isAccelerator()` to `shared/config.ts`. Each of
  the three hotkey strings is now validated to contain only ASCII letters, digits, and
  the `+` separator (length 2–64) before being passed to `globalShortcut.register()`.
  Invalid values fall back to the built-in defaults.

- **`status._timer` DOM-property removed** — `settings.js` now uses a module-level
  `let statusTimer` variable instead of attaching a non-standard `_timer` property
  directly to the DOM element, eliminating a minor DOM-clobbering footprint.

### Fixed

- **Rendering parameters not applied after saving settings** (`shared/types.ts`, `electron/main/main.ts`, `renderer/main.ts`)

  Saving settings only pushed `effect`, `enabled`, and `interactive` to the overlay
  renderer; all other fields (`opacity`, `lineWidth`, `color`, `secondaryColor`,
  `trailLength`, `particleCount`, `fpsCap`) were silently ignored until the next
  app restart.  Root cause: `applyNewConfig` sent three narrow commands but had no
  way to forward the full config.

  **Fix:** added a `config-changed` variant to `TrailCommand` carrying the complete
  `TrailConfig`.  `applyNewConfig` now emits this command first, so the renderer calls
  `engine.setConfig()` with the validated merged config immediately.  All visual
  parameters — including cursor-glow head size (tied to `lineWidth`) — update in real
  time the moment the user clicks 保存并应用.

- **Trail disappears on vertical movement and sharp turns** (`renderer/trail/effects.ts`)

  `drawFadingPathFast` previously built a single `createLinearGradient(first, last)`
  spanning the spatial distance between the oldest and newest trail sample, then applied
  it to the entire path in one `stroke()` call.  Canvas resolves each pixel's color by
  projecting that pixel perpendicularly onto the gradient axis.  When the path bends or
  reverses direction the projection falls outside the `[0, 1]` range and Canvas clamps it
  to the nearest stop, causing large segments to render at the wrong opacity — most
  visibly a long section appearing to vanish entirely on vertical strokes (where prior
  horizontal movement makes the gradient axis diagonal) or at sharp-angle turns.

  **Fix:** replaced the single spatial gradient with 16 sequential bucket strokes.  Each
  bucket covers an equal slice of the sample array by index (which approximates arc-length
  because `createSmoothSamples` interpolates at roughly constant pixel spacing).  Alpha is
  derived from the midpoint sample's `recency` value, the same formula used previously,
  so the visual fade curve is unchanged.  The fix applies to the *Neon Ribbon* and *Comet
  Tail* effects which both route through `drawFadingPathFast`.

---

## [0.1.0] - initial release

- Six cursor trail effects: Neon Ribbon, Particle Spark, Comet Tail, Smoke Trail,
  Pixel Ghost, Fluid Blob.
- Transparent always-on-top Electron overlay; click-through enabled by default.
- System tray with Chinese-language menu; global hotkeys (`Ctrl+Alt+J/K/P`).
- Settings window with live preview of all parameters.
- Config persisted to user data directory; falls back to `config/default.json`.
- Multi-monitor support via `unionRects`.
- Canvas 2D rendering with Catmull-Rom spline smoothing.
- Electron Builder packaging to NSIS installer and portable `.exe`.
