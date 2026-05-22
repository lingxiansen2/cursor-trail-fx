import { spawn, type ChildProcessByStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

type ProbeChild = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Polls the Win32 input desktop name from a long-lived PowerShell child
 * process. When the input desktop is not the user's normal "Default" desktop
 * — e.g. UAC consent prompt (Winlogon desktop), lock screen, screen saver —
 * Win32 window APIs called from this process (SetWindowPos, ShowWindow,
 * DestroyWindow, ...) may block the main thread for the entire duration of
 * the secure desktop session (up to the UAC auto-cancel timeout of 120s).
 *
 * Electron's powerMonitor surfaces "lock-screen" / "unlock-screen" via
 * WTSRegisterSessionNotification, which fires reliably for Win+L lock and
 * sleep but does NOT fire for UAC consent prompts. This probe fills that
 * gap so the main process can stop touching window APIs the moment the
 * input desktop changes, regardless of cause.
 *
 * Implementation note: no native module is required. The probe uses
 * PowerShell's Add-Type to P/Invoke user32!OpenInputDesktop and
 * user32!GetUserObjectInformationW. Both calls return immediately even when
 * the calling process is not on the input desktop, so the probe itself
 * cannot get stuck.
 */

const PROBE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$source = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class IDP {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")]
  public static extern bool GetUserObjectInformation(IntPtr h, int nIndex, StringBuilder pvInfo, uint nLength, out uint lpnLengthNeeded);
  [DllImport("user32.dll")]
  public static extern bool CloseDesktop(IntPtr h);
}
"@
Add-Type -TypeDefinition $source -Language CSharp | Out-Null
[Console]::Out.WriteLine("IDP:READY")
[Console]::Out.Flush()
$last = ""
while ($true) {
  $h = [IDP]::OpenInputDesktop(0, $false, 0x100)
  if ($h -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 256
    $n = 0
    [void][IDP]::GetUserObjectInformation($h, 2, $sb, 512, [ref]$n)
    $name = $sb.ToString().Trim([char]0).Trim()
    [void][IDP]::CloseDesktop($h)
  } else {
    $name = "Inaccessible"
  }
  if ($name -ne $last) {
    [Console]::Out.WriteLine("IDP:$name")
    [Console]::Out.Flush()
    $last = $name
  }
  Start-Sleep -Milliseconds 150
}
`;

export type InputDesktopName = string;

export interface InputDesktopChange {
  from: InputDesktopName;
  to: InputDesktopName;
}

class InputDesktopProbe extends EventEmitter {
  private child: ProbeChild | undefined;
  private currentName: InputDesktopName = "Default";
  private lastUpdateMs = Date.now();
  private stopped = true;
  private restartTimer: NodeJS.Timeout | undefined;
  private stdoutBuf = "";

  start(): void {
    if (process.platform !== "win32") {
      return;
    }
    if (this.child) {
      return;
    }
    this.stopped = false;
    this.spawnChild();
  }

  private spawnChild(): void {
    try {
      this.child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          PROBE_SCRIPT
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
      ) as ProbeChild;
    } catch (err) {
      console.warn("[input-desktop] failed to spawn probe:", err);
      this.scheduleRestart();
      return;
    }

    this.stdoutBuf = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.stdoutBuf += chunk;
      const lines = this.stdoutBuf.split(/\r?\n/);
      this.stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^IDP:(.+)$/.exec(line);
        if (!match) {
          continue;
        }
        const value = match[1].trim();
        if (value === "READY") {
          continue;
        }
        const prev = this.currentName;
        this.currentName = value;
        this.lastUpdateMs = Date.now();
        if (prev !== this.currentName) {
          const payload: InputDesktopChange = { from: prev, to: this.currentName };
          this.emit("change", payload);
        }
      }
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) {
        console.warn("[input-desktop] probe stderr:", text);
      }
    });

    this.child.on("exit", (code, signal) => {
      console.info(`[input-desktop] probe exited code=${code} signal=${signal}`);
      this.child = undefined;
      if (!this.stopped) {
        this.scheduleRestart();
      }
    });

    this.child.on("error", (err) => {
      console.warn("[input-desktop] probe error:", err);
    });
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.stopped) {
      return;
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.stopped) {
        this.spawnChild();
      }
    }, 2000);
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        // Ignore: child may already be gone.
      }
      this.child = undefined;
    }
  }

  /**
   * Returns true when the current input desktop is the normal user
   * "Default" desktop. Non-Windows platforms always return true so callers
   * can use this as a gate without per-platform branching.
   */
  isOnDefault(): boolean {
    if (process.platform !== "win32") {
      return true;
    }
    return this.currentName === "Default";
  }

  /** Current input desktop name, e.g. "Default", "Winlogon", "Screen-saver". */
  getName(): InputDesktopName {
    return this.currentName;
  }

  /** Milliseconds since the probe last observed a desktop name. */
  ageMs(): number {
    return Date.now() - this.lastUpdateMs;
  }
}

export const inputDesktopProbe = new InputDesktopProbe();