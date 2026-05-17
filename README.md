# Cursor Trail FX

A Windows-first transparent desktop overlay that renders selectable cursor trail effects behind the pointer.

## Commands

Use `npm.cmd` in PowerShell if script execution policy blocks `npm.ps1`.

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run check
npm.cmd run build
```

## Controls

- `Ctrl+Alt+J`: switch to the next trail effect.
- `Ctrl+Alt+K`: enable or disable the trail.
- `Ctrl+Alt+P`: toggle click-through mode.
- Tray menu: enable/disable, next effect, choose a specific effect, toggle click-through, quit.

## Effects

- Neon ribbon
- Particle spark
- Comet tail
- Smoke trail
- Pixel ghost
- Fluid blob

## Notes

- The app creates a transparent, frameless, always-on-top Electron overlay across the current virtual desktop.
- Click-through is enabled by default, so the overlay does not block normal mouse use.
- Rendering uses Canvas 2D for the first version. The effect system is plugin-shaped so WebGL effects can be added later.
- All cat model, sprite, and pet state-machine code has been removed.
