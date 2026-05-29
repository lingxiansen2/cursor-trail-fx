# Changelog

All notable changes to Cursor Trail FX are documented here.

---

## [Unreleased] - 2026-05-22

### Fixed

- **Main process froze for up to 2 minutes during UAC consent prompts**
  (`electron/main/inputDesktop.ts` *(new)*, `electron/main/main.ts`)

  Electron's `powerMonitor` surfaces `lock-screen` / `unlock-screen` reliably
  (it sits on top of `WTSRegisterSessionNotification`), but **never fires for
  UAC consent prompts**. When UAC switched the input desktop to `Winlogon`,
  the overlay health loop (every 3 s) and the cursor sampling loop (~120 Hz)
  kept calling Win32 setters — `SetAlwaysOnTop`, `SetVisibleOnAllWorkspaces`,
  `SetSkipTaskbar`, `SetFocusable`, `SetIgnoreMouseEvents` — against a window
  whose desktop was no longer the input desktop. Each call serialized on the
  Win32 side and stacked up, freezing the main thread until the UAC prompt's
  auto-cancel timeout (≈120 s) released them.

  **Fix:**
  - Added `electron/main/inputDesktop.ts`. It spawns a long-lived PowerShell
    child that polls `user32!OpenInputDesktop` + `GetUserObjectInformationW`
    every 150 ms and emits a line on stdout when the input desktop name
    changes. Both Win32 calls return immediately even from a process that is
    not on the input desktop, so the probe itself cannot stall. No native
    module is required — PowerShell does the P/Invoke via `Add-Type`.
  - Added `isInputDesktopForeign()` in `main.ts`. `reinforceOverlayWindow`
    and the cursor sampling tick both call it at entry and short-circuit on
    Windows when the input desktop is anything other than `Default`. This
    keeps every periodic Win32 setter off the main thread during UAC.
  - Added `disposeOverlayWindow(staleWindow)` that performs `hide()`
    synchronously and defers `destroy()` to `setImmediate` inside a
    `try/catch`. Both `pauseForSecureDesktop` and `recreateOverlayWindow`
    now go through it so the heavy `DestroyWindow` call cannot hold the
    main thread while the input desktop is foreign.
  - `inputDesktopProbe.on("change")` is wired into `app.whenReady` ahead of
    the existing `powerMonitor` listeners — a transition to `Default`
    schedules recovery with a 150 ms debounce, anything else triggers
    `pauseForSecureDesktop`. The existing `powerMonitor` listeners are
    retained as redundancy (and remain the primary signal for Win+L,
    sleep, and macOS / Linux).
  - `startSecureDesktopWatchdog` now polls every 750 ms (down from 1.5 s)
    and prefers `inputDesktopProbe.isOnDefault()` as the recovery signal,
    falling back to the old `getSystemIdleState` heuristic when the probe
    is unavailable.

  Expected behavior after the fix: UAC pop-up triggers `pauseForSecureDesktop`
  within ~150 ms; UAC dismissal triggers `recoverFromSecureDesktop` within
  another 150–300 ms. The main thread no longer accumulates stuck Win32
  calls, so the 2-minute freeze is gone. The overlay still cannot render
  on top of the UAC dialog itself — that requires SYSTEM-level injection
  into the Winlogon desktop, which is intentionally blocked by Windows
  and out of scope for a user-mode application.

### Security

- (Earlier 2026-05-16 entries preserved below.)

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

  Saving settings only pushed `effect` and `enabled` to the overlay
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
- Transparent always-on-top Electron overlay; always click-through.
- System tray with Chinese-language menu; global hotkeys (`Ctrl+Alt+J/K`).
- Settings window with live preview of all parameters.
- Config persisted to user data directory; falls back to `config/default.json`.
- Multi-monitor support via `unionRects`.
- Canvas 2D rendering with Catmull-Rom spline smoothing.
- Electron Builder packaging to NSIS installer and portable `.exe`.
