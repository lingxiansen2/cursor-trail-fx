import { contextBridge, ipcRenderer } from "electron";

const settingsApi = {
  getData: (): Promise<{
    config: Record<string, unknown>;
    effects: Array<{ id: string; label: string }>;
    autoLaunch: boolean;
  }> => ipcRenderer.invoke("settings:get-data"),

  save: (config: Record<string, unknown>, autoLaunch: boolean): Promise<boolean> =>
    ipcRenderer.invoke("settings:save", config, autoLaunch),

  openUserData: (): Promise<void> => ipcRenderer.invoke("settings:open-user-data"),

  close: (): void => {
    window.close();
  }
};

contextBridge.exposeInMainWorld("settingsApi", settingsApi);
