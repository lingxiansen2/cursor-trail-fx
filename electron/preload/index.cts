import { contextBridge, ipcRenderer } from "electron";
import type { CursorPosition, CursorSnapshot, TrailCommand, TrailConfig, TrailEffectId } from "../../shared/types.js";

const trailApi = {
  getConfig: (): Promise<TrailConfig> => ipcRenderer.invoke("trail:get-config"),
  getCursorSnapshot: (): Promise<CursorSnapshot> => ipcRenderer.invoke("trail:get-cursor-snapshot"),
  setEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke("trail:set-enabled", enabled),
  setEffect: (effect: TrailEffectId): Promise<void> => ipcRenderer.invoke("trail:set-effect", effect),
  nextEffect: (): Promise<TrailEffectId> => ipcRenderer.invoke("trail:next-effect"),
  onCommand: (callback: (command: TrailCommand) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: TrailCommand) => callback(command);
    ipcRenderer.on("trail:command", listener);
    return () => ipcRenderer.off("trail:command", listener);
  },
  onCursor: (callback: (snapshot: CursorSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: CursorSnapshot) => callback(snapshot);
    ipcRenderer.on("trail:cursor", listener);
    return () => ipcRenderer.off("trail:cursor", listener);
  },
  onCursorPosition: (callback: (position: CursorPosition) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, position: CursorPosition) => callback(position);
    ipcRenderer.on("trail:cursor-position", listener);
    return () => ipcRenderer.off("trail:cursor-position", listener);
  }
};

contextBridge.exposeInMainWorld("trailApi", trailApi);
