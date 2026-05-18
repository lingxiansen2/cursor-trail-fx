/* Settings window controller. Kept external so CSP can allow script-src 'self'. */
"use strict";

const api = window.settingsApi;

let statusTimer = undefined;

function $(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element;
}

function asErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertSettingsData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("主进程没有返回设置数据，请重启程序后再试");
  }
  if (!data.config || !Array.isArray(data.effects)) {
    throw new Error("设置数据格式不完整，请重启程序后再试");
  }
}

function bindSlider(id, formatter) {
  const slider = $(id);
  const label = $(`${id}-val`);
  slider.addEventListener("input", () => {
    label.textContent = formatter(slider.value);
  });
}

function bindColor(id) {
  const picker = $(id);
  const label = $(`${id}-hex`);
  picker.addEventListener("input", () => {
    label.textContent = picker.value;
  });
}

function showStatus(message, isError = false) {
  const status = $("status");
  status.textContent = message;
  status.className = `status visible${isError ? " error" : ""}`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.className = "status";
  }, 2200);
}

async function init() {
  if (!api) {
    throw new Error("settingsApi 未加载");
  }

  const data = await api.getData();
  assertSettingsData(data);
  const { config, effects, autoLaunch } = data;

  const effectSelect = $("effect");
  effectSelect.textContent = "";
  effects.forEach(({ id, label }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label;
    option.selected = id === config.effect;
    effectSelect.appendChild(option);
  });

  $("color").value = config.color ?? "#62d6ff";
  $("color-hex").textContent = $("color").value;
  $("secondaryColor").value = config.secondaryColor ?? "#c084fc";
  $("secondaryColor-hex").textContent = $("secondaryColor").value;
  bindColor("color");
  bindColor("secondaryColor");

  const opacity = Math.round((config.opacity ?? 0.92) * 100);
  $("opacity").value = opacity;
  $("opacity-val").textContent = `${opacity}%`;
  bindSlider("opacity", (value) => `${value}%`);

  $("trailLength").value = config.trailLength ?? 120;
  $("trailLength-val").textContent = $("trailLength").value;
  bindSlider("trailLength", (value) => value);

  $("particleCount").value = config.particleCount ?? 120;
  $("particleCount-val").textContent = $("particleCount").value;
  bindSlider("particleCount", (value) => value);

  $("lineWidth").value = config.lineWidth ?? 14;
  $("lineWidth-val").textContent = `${$("lineWidth").value}px`;
  bindSlider("lineWidth", (value) => `${value}px`);

  $("fpsCap").value = config.fpsCap ?? 240;
  $("fpsCap-val").textContent = `${$("fpsCap").value}Hz`;
  bindSlider("fpsCap", (value) => `${value}Hz`);

  $("enabled").checked = config.enabled !== false;
  $("clickThroughDefault").checked = config.clickThroughDefault !== false;
  $("autoLaunch").checked = Boolean(autoLaunch);

  $("hotkey-nextEffect").value = config.hotkey?.nextEffect ?? "CommandOrControl+Alt+J";
  $("hotkey-toggleEnabled").value = config.hotkey?.toggleEnabled ?? "CommandOrControl+Alt+K";
  $("hotkey-toggleInteractive").value =
    config.hotkey?.toggleInteractive ?? "CommandOrControl+Alt+P";

  $("loading").style.display = "none";
  $("body").hidden = false;
}

async function save() {
  const button = $("btn-save");
  button.disabled = true;

  const nextConfig = {
    effect: $("effect").value,
    color: $("color").value,
    secondaryColor: $("secondaryColor").value,
    opacity: Number.parseFloat($("opacity").value) / 100,
    trailLength: Number.parseInt($("trailLength").value, 10),
    particleCount: Number.parseInt($("particleCount").value, 10),
    lineWidth: Number.parseFloat($("lineWidth").value),
    fpsCap: Number.parseInt($("fpsCap").value, 10),
    enabled: $("enabled").checked,
    clickThroughDefault: $("clickThroughDefault").checked,
    hotkey: {
      nextEffect: $("hotkey-nextEffect").value.trim(),
      toggleEnabled: $("hotkey-toggleEnabled").value.trim(),
      toggleInteractive: $("hotkey-toggleInteractive").value.trim()
    }
  };

  try {
    const ok = await api.save(nextConfig, $("autoLaunch").checked);
    showStatus(ok ? "已保存并应用" : "保存失败", !ok);
  } catch (error) {
    showStatus(`出错：${asErrorMessage(error)}`, true);
  } finally {
    button.disabled = false;
  }
}

$("btn-save").addEventListener("click", save);
$("btn-cancel").addEventListener("click", () => api.close());
$("btn-userdata").addEventListener("click", () => api.openUserData());

init().catch((error) => {
  $("loading").textContent = `加载失败：${asErrorMessage(error)}`;
});
