function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/**
 * Fndesk Lite - 前端核心业务控制器
 * 包含：WeTab 极简图标裁剪工坊、WeTab 桌面卡片组件管理、立即生效与还原桌面防搞坏机制
 */

// API 根路径动态适配
const API_BASE = (function() {
  const p = window.location.pathname || "";
  if (p.includes("index.cgi")) {
    const idx = p.indexOf("index.cgi");
    return p.substring(0, idx + 9) + "/api";
  }
  if (p.includes("/app/fndesk")) {
    const idx = p.indexOf("/app/fndesk");
    return p.substring(0, idx + 11) + "/api";
  }
  if (window.location.port === "9990") {
    return "/api";
  }
  const m = p.match(/^(\/[a-zA-Z0-9_-]+)?\/cgi\/ThirdParty\/fndesk/);
  if (m) {
    return `${m[0]}/index.cgi/api`;
  }
  return "/api";
})();

// 通用 HTTP 请求助手
async function fetchApi(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const token = localStorage.getItem("fndesk_token");
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { "x-auth-token": token } : {}),
      ...(options.headers || {})
    };
    const res = await fetch(url, { credentials: "same-origin", ...options, headers });
    if (res.status === 401) {
      showLoginModal();
      throw new Error("请先登录");
    }
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.message || `请求错误 HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    console.error(`[API 异常] ${endpoint}:`, err);
    throw err;
  }
}

// Toast 提示
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  let icon = "fa-info-circle";
  if (type === "success") icon = "fa-check-circle";
  if (type === "error") icon = "fa-exclamation-triangle";
  el.innerHTML = `<i class="fa ${icon}"></i> <span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-8px)";
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

// ==================== 局域网地址解析 ====================
// 管理页可能通过 localhost / 127.0.0.1 打开，预览与桌面快捷方式
// 都必须使用 NAS 的局域网 IP，而不是访客自己的本地回环地址。
let cachedLanIp = "";

function isLoopbackHost(host) {
  return !host || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

async function ensureLanIp() {
  if (cachedLanIp) return cachedLanIp;
  try {
    const res = await fetchApi("/status");
    if (res && res.lanIp && !isLoopbackHost(res.lanIp)) {
      cachedLanIp = res.lanIp;
    }
  } catch (_) {}
  return cachedLanIp;
}

function preferredHost() {
  const host = window.location.hostname;
  if (!isLoopbackHost(host)) return host;
  return cachedLanIp || host;
}

function isPrivateIp(ip) {
  if (!ip) return false;
  if (ip === "localhost" || ip === "127.0.0.1" || ip === "::1" || ip === "[::1]") return true;
  if (cachedLanIp && ip === cachedLanIp) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  return false;
}

function isFnConnectHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  return h.includes("fnconnect.com") ||
         h.includes("5ddd.com") ||
         h.includes("fnos.net") ||
         h.includes("fnnas.com") ||
         h.includes("trzznas.com") ||
         h.startsWith("office.app.") ||
         h.includes(".app.5ddd.com");
}

function detectLinkType(host) {
  if (!host) return "LAN";
  if (isFnConnectHost(host)) return "FNCONNECT";
  if (isLoopbackHost(host) || isPrivateIp(host) || /\.local$/i.test(host) || /\.lan$/i.test(host) || /\.home\.arpa$/i.test(host)) {
    return "LAN";
  }
  return "DOMAIN";
}

function isWanAccess() {
  return detectLinkType(window.location.hostname) !== "LAN";
}

// 把图标配置解析为可直接打开的地址，自动支持内外网智能路由、端口+路径与协议适配
function resolveDesktopUrl(item) {
  if (!item) return "";
  const currentHost = window.location.hostname;
  const linkType = detectLinkType(currentHost);
  const rawLan = String(item.fndata_Lan || "").trim();
  const rawWan = String(item.fndata_Wan || "").trim();

  const userProto = Number(item.fndata_Protocol);
  const proto = userProto === 2 ? "https" : (userProto === 1 ? "http" : (window.location.protocol === "https:" ? "https" : "http"));

  let rawTarget = "";
  let targetHost = "";

  switch (linkType) {
    case "LAN":
      rawTarget = rawLan || rawWan;
      targetHost = preferredHost();
      break;
    case "FNCONNECT":
      if (rawWan) {
        rawTarget = rawWan;
        targetHost = currentHost;
      } else {
        rawTarget = rawLan;
        targetHost = preferredHost();
      }
      break;
    case "DOMAIN":
    default:
      rawTarget = rawWan || rawLan;
      targetHost = currentHost;
      break;
  }

  if (!rawTarget) return "";

  const formattedHost = (targetHost.includes(":") && !targetHost.startsWith("[")) ? `[${targetHost}]` : targetHost;

  const clean = rawTarget.replace(/^:/, "");
  const portMatch = clean.match(/^(\d+)(\/.*)?$/);
  if (portMatch) {
    const port = portMatch[1];
    const pathPart = portMatch[2] || "";
    return `${proto}://${formattedHost}:${port}${pathPart}`;
  }

  let url = clean;
  if (!/^https?:\/\//i.test(url)) {
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(url) && window.location.protocol === "https:") {
      url = `https://${url}`;
    } else {
      url = `${proto}://${url}`;
    }
  }
  return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|\[?::1\]?)(?=[:/]|$)/i,
    (_, scheme) => `${scheme}${formattedHost}`);
}

// ==================== 全局状态 ====================
const state = {
  icons: [],
  widgets: [],
  dockerContainers: [],
  activeFilter: "all",
  searchKeyword: "",
  activeMainTab: "icons",
  editingNative: false,
  desktopDirty: false,

  // 图标工坊状态 (WeTab 裁剪风格与文字图标)
  cropper: {
    mode: "image", // "image" 或 "text"
    text: "",
    fontSize: 64,
    fontColor: "#ffffff",
    image: null,
    rawSource: null,
    hasRawSource: false,
    scale: 1.0,
    panX: 0,
    panY: 0,
    rotation: 0,
    bgColor: "transparent",
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    startPanX: 0,
    startPanY: 0,
    isModified: false,
    isExistingIcon: false
  },

  // 小组件表单状态
  widgetForm: {
    id: null,
    type: "weather",
    size: "medium",
    title: "",
    targetDate: "",
    city: "北京",
    theme: "glass",
    style: "digital",
    content: ""
  }
};

// ==================== 桌面注入与还原防搞坏机制 ====================
async function checkDesktopStatus() {
  try {
    const res = await fetchApi("/desktop-status");
    const badge = document.getElementById("badgeDesktopStatus");
    const text = document.getElementById("textDesktopStatus");
    if (res.injected) {
      badge.classList.add("is-mounted");
      text.textContent = "已挂载桌面";
    } else {
      badge.classList.remove("is-mounted");
      text.textContent = "未挂载桌面";
    }
  } catch (_) {}
}

async function applyDesktop() {
  const btn = document.getElementById("btnApplyDesktop");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> <span>生效中...</span>`;
  try {
    const res = await fetchApi("/apply-desktop", { method: "POST" });
    markDesktopDirty(false);
    showToast(res.message || "飞牛桌面已生效！正在同步刷新桌面...", "success");
    checkDesktopStatus();
    setTimeout(() => {
      try {
        if (window.top && window.top !== window) {
          window.top.location.reload();
        } else if (window.parent && window.parent !== window) {
          window.parent.location.reload();
        } else {
          window.location.reload();
        }
      } catch (_) {
        window.location.reload();
      }
    }, 600);
  } catch (err) {
    showToast("立即生效失败: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa fa-bolt"></i> <span>立即生效</span>`;
  }
}

async function restoreDesktop() {
  const btn = document.getElementById("btnConfirmRestore");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> <span>正在还原...</span>`;
  try {
    const res = await fetchApi("/restore-desktop", { method: "POST" });
    markDesktopDirty(false);
    showToast(res.message || "桌面已彻底还原为出厂状态！正在刷新桌面...", "success");
    closeModal("restoreConfirmModal");
    checkDesktopStatus();
    setTimeout(() => {
      try {
        if (window.top && window.top !== window) {
          window.top.location.reload();
        } else if (window.parent && window.parent !== window) {
          window.parent.location.reload();
        } else {
          window.location.reload();
        }
      } catch (_) {
        window.location.reload();
      }
    }, 600);
  } catch (err) {
    showToast("还原失败: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa fa-history"></i> <span>确认一键还原</span>`;
  }
}

// ==================== WeTab 极简图标裁剪工坊 (图 3 同款) ====================
const WETAB_PALETTE = [
  // 第一排
  { color: "transparent", title: "透明" },
  { color: "#ffffff", title: "纯白" },
  { color: "#475569", title: "岩灰" },
  { color: "#0f172a", title: "深黑" },
  { color: "#f59e0b", title: "琥珀黄" },
  { color: "#10b981", title: "翠绿" },
  { color: "#06b6d4", title: "青碧" },
  { color: "#38bdf8", title: "天蓝" },
  { color: "#3b82f6", title: "官方蓝" },
  { color: "#8b5cf6", title: "魅紫" },
  // 第二排
  { color: "#ec4899", title: "品粉" },
  { color: "#f43f5e", title: "珊瑚红" },
  { color: "#ef4444", title: "正红" },
  { color: "#e2d9cc", title: "米白" },
  { color: "#d4a373", title: "浅驼" },
  { color: "#8d5b4c", title: "醇棕" },
  { color: "#65a30d", title: "草绿" },
  { color: "#52b788", title: "薄荷" },
  { color: "#a5b4fc", title: "淡紫" },
  { color: "rainbow", title: "自定义取色" }
];

function initPaletteDots() {
  const container = document.getElementById("paletteDots");
  container.innerHTML = "";
  WETAB_PALETTE.forEach(item => {
    const dot = document.createElement("div");
    dot.className = "palette-dot";
    dot.title = item.title;

    if (item.color === "transparent") {
      dot.style.background = "linear-gradient(45deg, #bbb 25%, transparent 25%), linear-gradient(-45deg, #bbb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #bbb 75%), linear-gradient(-45deg, transparent 75%, #bbb 75%)";
      dot.style.backgroundSize = "6px 6px";
      dot.style.backgroundColor = "#fff";
    } else if (item.color === "rainbow") {
      dot.className += " palette-dot-rainbow";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.style.opacity = "0";
      picker.style.position = "absolute";
      picker.style.inset = "0";
      picker.style.cursor = "pointer";
      picker.onchange = e => {
        state.cropper.bgColor = e.target.value;
        renderCropCanvas();
        updateActiveDot(dot);
      };
      dot.appendChild(picker);
    } else {
      dot.style.backgroundColor = item.color;
    }

    if (state.cropper.bgColor === item.color) {
      dot.classList.add("active");
    }

    dot.addEventListener("click", () => {
      if (item.color !== "rainbow") {
        state.cropper.bgColor = item.color;
        renderCropCanvas();
        updateActiveDot(dot);
      }
    });

    container.appendChild(dot);
  });
}

function updateActiveDot(activeEl) {
  document.querySelectorAll(".palette-dot").forEach(d => d.classList.remove("active"));
  if (activeEl) activeEl.classList.add("active");
}

// 绘制飞牛官方原生平滑圆角 Squircle
function drawFnSquircle(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function renderCropCanvas() {
  const canvas = document.getElementById("studioCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const size = canvas.width; // 256
  ctx.clearRect(0, 0, size, size);

  // 飞牛官方平滑圆角 (~22%)
  const r = size * 0.22;

  // 裁剪路径
  ctx.save();
  drawFnSquircle(ctx, 0, 0, size, size, r);
  ctx.clip();

  // 底色填充
  if (state.cropper.bgColor && state.cropper.bgColor !== "transparent") {
    ctx.fillStyle = state.cropper.bgColor;
    ctx.fillRect(0, 0, size, size);
  }

  if (state.cropper.mode === "text") {
    // ========== 文字图标模式 ==========
    const rawText = String(state.cropper.text || "").trim();
    if (rawText) {
      const lines = rawText.split("\n");
      const numLines = lines.length;
      const fontSize = Number(state.cropper.fontSize) || 64;
      const fontColor = state.cropper.fontColor || "#ffffff";

      const lineHeight = fontSize * 1.18;
      const totalHeight = (numLines - 1) * lineHeight;
      const centerY = size / 2 + state.cropper.panY;
      const startY = centerY - (totalHeight / 2);
      const centerX = size / 2 + state.cropper.panX;

      const fontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif';
      ctx.font = `bold ${fontSize}px ${fontStack}`;
      ctx.fillStyle = fontColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const maxLineWidth = size * 0.85;

      lines.forEach((line, idx) => {
        const y = startY + idx * lineHeight;
        const textMetrics = ctx.measureText(line);
        if (textMetrics.width > maxLineWidth && textMetrics.width > 0) {
          const s = maxLineWidth / textMetrics.width;
          ctx.save();
          ctx.translate(centerX, y);
          ctx.scale(s, s);
          ctx.fillText(line, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(line, centerX, y);
        }
      });
    }
  } else {
    // ========== 图片模式 ==========
    if (state.cropper.image) {
      ctx.save();
      ctx.translate(size / 2 + state.cropper.panX, size / 2 + state.cropper.panY);
      ctx.rotate((state.cropper.rotation * Math.PI) / 180);
      ctx.scale(state.cropper.scale, state.cropper.scale);

      const img = state.cropper.image;
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;

      // 如果是原始原图（含新上传/抓取及已保存原图的图标），按 0.75 留出优雅边距；
      // 仅当历史遗留没有原图的成型已有图标时，按 1:1 完整铺满裁剪画布
      const ratio = (!state.cropper.hasRawSource && state.cropper.isExistingIcon) ? 1.0 : 0.75;
      const fitScale = (size * ratio) / Math.max(iw, ih);
      const dw = iw * fitScale;
      const dh = ih * fitScale;

      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
  }

  ctx.restore();
}

// 切换图标工坊模式：图片模式 / 文字图标模式
function setCropperMode(mode, doRender = true) {
  state.cropper.mode = mode;
  state.cropper.isModified = true;

  const tabImg = document.getElementById("tabModeImage");
  const tabTxt = document.getElementById("tabModeText");
  const actionsImg = document.getElementById("imageModeActions");
  const panelTxt = document.getElementById("textModePanel");
  const onlineBar = document.getElementById("onlineUrlBar");

  if (mode === "text") {
    if (tabTxt) tabTxt.classList.add("active");
    if (tabImg) tabImg.classList.remove("active");
    if (actionsImg) actionsImg.style.display = "none";
    if (onlineBar) onlineBar.style.display = "none";
    if (panelTxt) panelTxt.style.display = "flex";

    // 若文字为空，优先自动从标题同步
    if (!state.cropper.text) {
      const title = document.getElementById("fieldTitle")?.value.trim() || "";
      state.cropper.text = title;
      const txtInput = document.getElementById("fieldTextContent");
      if (txtInput) txtInput.value = title;
    }
    // 文字图标必须有底色，若为透明则默认使用经典飞牛蓝
    if (!state.cropper.bgColor || state.cropper.bgColor === "transparent") {
      state.cropper.bgColor = "#3b82f6";
      initPaletteDots();
    }
  } else {
    if (tabImg) tabImg.classList.add("active");
    if (tabTxt) tabTxt.classList.remove("active");
    if (actionsImg) actionsImg.style.display = "flex";
    if (panelTxt) panelTxt.style.display = "none";
  }

  if (doRender) {
    renderCropCanvas();
  }
}

// 加载并解析在线图片地址 (绕过防盗链与 CORS 跨域污染)
async function handleLoadOnlineUrl(inputUrl) {
  const url = (inputUrl || document.getElementById("fieldOnlineImgUrl")?.value || "").trim();
  if (!url) return showToast("请输入或粘贴在线图片地址", "error");

  const btn = document.getElementById("btnConfirmOnlineUrl");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i>`;
  }

  try {
    const res = await fetchApi("/fetch-online-image", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    if (res.dataUrl) {
      setCropperMode("image", false);
      state.cropper.isModified = true;
      state.cropper.isExistingIcon = false;
      state.cropper.hasRawSource = true;
      state.cropper.rawSource = res.dataUrl;
      state.cropper.scale = 1.0;
      state.cropper.panX = 0;
      state.cropper.panY = 0;
      state.cropper.rotation = 0;
      loadCropperImage(res.dataUrl, false, true);
      showToast("在线图片加载成功！", "success");
      const bar = document.getElementById("onlineUrlBar");
      if (bar) bar.style.display = "none";
    } else {
      throw new Error(res.message || "未能获取在线图片");
    }
  } catch (err) {
    // 降级：直接尝试前端加载
    try {
      setCropperMode("image", false);
      state.cropper.isModified = true;
      state.cropper.isExistingIcon = false;
      loadCropperImage(url, false);
      showToast("在线图片已加载", "success");
      const bar = document.getElementById("onlineUrlBar");
      if (bar) bar.style.display = "none";
    } catch (_) {
      showToast("获取在线图片失败: " + err.message, "error");
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `加载`;
    }
  }
}

function loadCropperImage(src, isExisting = false, hasRaw = false) {
  if (!src) return;
  const img = new Image();
  if (!src.startsWith("data:")) {
    img.crossOrigin = "anonymous";
  }
  img.onload = () => {
    state.cropper.image = img;
    state.cropper.isExistingIcon = isExisting;
    state.cropper.hasRawSource = hasRaw;
    renderCropCanvas();
  };
  img.onerror = () => {
    if (img.crossOrigin) {
      const fallbackImg = new Image();
      fallbackImg.onload = () => {
        state.cropper.image = fallbackImg;
        state.cropper.isExistingIcon = isExisting;
        state.cropper.hasRawSource = hasRaw;
        renderCropCanvas();
      };
      fallbackImg.src = src;
    }
  };
  img.src = src;
}

function initCanvasEvents() {
  const wrapper = document.getElementById("canvasContainer");
  const displayRatio = 256 / 114;

  // 拖动平移
  wrapper.addEventListener("mousedown", e => {
    state.cropper.isDragging = true;
    state.cropper.dragStartX = e.clientX;
    state.cropper.dragStartY = e.clientY;
    state.cropper.startPanX = state.cropper.panX;
    state.cropper.startPanY = state.cropper.panY;
  });

  window.addEventListener("mousemove", e => {
    if (!state.cropper.isDragging) return;
    const dx = (e.clientX - state.cropper.dragStartX) * displayRatio;
    const dy = (e.clientY - state.cropper.dragStartY) * displayRatio;
    state.cropper.panX = state.cropper.startPanX + dx;
    state.cropper.panY = state.cropper.startPanY + dy;
    state.cropper.isModified = true;
    renderCropCanvas();
  });

  window.addEventListener("mouseup", () => {
    state.cropper.isDragging = false;
  });

  // 显示缩放倍率悬浮提示并更新按钮 tooltip
  let zoomBadgeTimer = null;
  function showZoomBadge() {
    const badge = document.getElementById("cropZoomBadge");
    const pct = Math.round(state.cropper.scale * 100);
    if (badge) {
      badge.textContent = `${pct}%`;
      badge.classList.add("is-visible");
      if (zoomBadgeTimer) clearTimeout(zoomBadgeTimer);
      zoomBadgeTimer = setTimeout(() => {
        badge.classList.remove("is-visible");
      }, 1200);
    }

    const zoomInBtn = document.getElementById("btnZoomIn");
    const zoomOutBtn = document.getElementById("btnZoomOut");
    const resetBtn = document.getElementById("btnResetCrop");
    if (state.cropper.mode === "text") {
      const sz = state.cropper.fontSize || 64;
      if (badge) badge.textContent = `${sz}px`;
      if (zoomInBtn) zoomInBtn.title = `放大字号 (当前 ${sz}px)`;
      if (zoomOutBtn) zoomOutBtn.title = `缩小字号 (当前 ${sz}px)`;
      if (resetBtn) resetBtn.title = `居中重置`;
    } else {
      if (zoomInBtn) zoomInBtn.title = `放大 (当前 ${pct}%，上限 2000%)`;
      if (zoomOutBtn) zoomOutBtn.title = `缩小 (当前 ${pct}%，下限 10%)`;
      if (resetBtn) resetBtn.title = `重置位置与缩放 (当前 ${pct}%)`;
    }
  }

  // 滚轮缩放
  wrapper.addEventListener("wheel", e => {
    e.preventDefault();
    if (state.cropper.mode === "text") {
      const delta = e.deltaY > 0 ? -2 : 2;
      const cur = Number(state.cropper.fontSize) || 64;
      const next = Math.max(18, Math.min(140, cur + delta));
      state.cropper.fontSize = next;
      const slider = document.getElementById("fieldTextSize");
      if (slider) slider.value = next;
      const badge = document.getElementById("textSizeBadge");
      if (badge) badge.textContent = `${next}px`;
      state.cropper.isModified = true;
      renderCropCanvas();
      showZoomBadge();
      return;
    }
    // 按比例平滑缩放，解除 3.0x 限制，支持 0.1x (10%) ~ 20.0x (2000%)
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    state.cropper.scale = Math.max(0.1, Math.min(20.0, parseFloat((state.cropper.scale * factor).toFixed(3))));
    state.cropper.isModified = true;
    renderCropCanvas();
    showZoomBadge();
  }, { passive: false });

  // 双击画布重置大小与位置
  wrapper.addEventListener("dblclick", () => {
    state.cropper.scale = 1.0;
    state.cropper.panX = 0;
    state.cropper.panY = 0;
    state.cropper.rotation = 0;
    state.cropper.isModified = true;
    renderCropCanvas();
    showZoomBadge();
  });

  // 触摸屏单指拖拽与双指捏合缩放支持
  let touchStartDist = 0;
  let touchStartScale = 1.0;
  wrapper.addEventListener("touchstart", e => {
    if (e.touches.length === 1) {
      state.cropper.isDragging = true;
      state.cropper.dragStartX = e.touches[0].clientX;
      state.cropper.dragStartY = e.touches[0].clientY;
      state.cropper.startPanX = state.cropper.panX;
      state.cropper.startPanY = state.cropper.panY;
    } else if (e.touches.length === 2) {
      state.cropper.isDragging = false;
      touchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartScale = state.cropper.scale;
    }
  }, { passive: true });

  wrapper.addEventListener("touchmove", e => {
    if (e.touches.length === 1 && state.cropper.isDragging) {
      const dx = (e.touches[0].clientX - state.cropper.dragStartX) * displayRatio;
      const dy = (e.touches[0].clientY - state.cropper.dragStartY) * displayRatio;
      state.cropper.panX = state.cropper.startPanX + dx;
      state.cropper.panY = state.cropper.startPanY + dy;
      state.cropper.isModified = true;
      renderCropCanvas();
    } else if (e.touches.length === 2 && touchStartDist > 0) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / touchStartDist;
      state.cropper.scale = Math.max(0.1, Math.min(20.0, parseFloat((touchStartScale * ratio).toFixed(3))));
      state.cropper.isModified = true;
      renderCropCanvas();
      showZoomBadge();
    }
  }, { passive: true });

  wrapper.addEventListener("touchend", () => {
    state.cropper.isDragging = false;
    touchStartDist = 0;
  });

  // 工具栏按钮控制
  document.getElementById("btnRotateCCW").onclick = () => {
    state.cropper.rotation = (state.cropper.rotation - 90) % 360;
    state.cropper.isModified = true;
    renderCropCanvas();
  };
  document.getElementById("btnRotateCW").onclick = () => {
    state.cropper.rotation = (state.cropper.rotation + 90) % 360;
    state.cropper.isModified = true;
    renderCropCanvas();
  };
  document.getElementById("btnResetCrop").onclick = () => {
    state.cropper.scale = 1.0;
    state.cropper.panX = 0;
    state.cropper.panY = 0;
    state.cropper.rotation = 0;
    state.cropper.isModified = true;
    renderCropCanvas();
    showZoomBadge();
  };
  document.getElementById("btnZoomOut").onclick = () => {
    if (state.cropper.mode === "text") {
      const cur = Number(state.cropper.fontSize) || 64;
      const next = Math.max(18, cur - 4);
      state.cropper.fontSize = next;
      const slider = document.getElementById("fieldTextSize");
      if (slider) slider.value = next;
      const badge = document.getElementById("textSizeBadge");
      if (badge) badge.textContent = `${next}px`;
      state.cropper.isModified = true;
      renderCropCanvas();
      showZoomBadge();
      return;
    }
    const step = Math.max(0.08, parseFloat((state.cropper.scale * 0.15).toFixed(3)));
    state.cropper.scale = Math.max(0.1, parseFloat((state.cropper.scale - step).toFixed(2)));
    state.cropper.isModified = true;
    renderCropCanvas();
    showZoomBadge();
  };
  document.getElementById("btnZoomIn").onclick = () => {
    if (state.cropper.mode === "text") {
      const cur = Number(state.cropper.fontSize) || 64;
      const next = Math.min(140, cur + 4);
      state.cropper.fontSize = next;
      const slider = document.getElementById("fieldTextSize");
      if (slider) slider.value = next;
      const badge = document.getElementById("textSizeBadge");
      if (badge) badge.textContent = `${next}px`;
      state.cropper.isModified = true;
      renderCropCanvas();
      showZoomBadge();
      return;
    }
    const step = Math.max(0.08, parseFloat((state.cropper.scale * 0.15).toFixed(3)));
    state.cropper.scale = Math.min(20.0, parseFloat((state.cropper.scale + step).toFixed(2)));
    state.cropper.isModified = true;
    renderCropCanvas();
    showZoomBadge();
  };
}

// ==================== 图标数据管理 ====================
async function loadIcons() {
  try {
    const data = await fetchApi("/icons");
    state.icons = data.icons || [];
    renderIcons();
    updateStats();
  } catch (err) {
    showToast("获取图标列表失败: " + err.message, "error");
  }
}

function renderIcons() {
  const grid = document.getElementById("iconGrid");
  const keyword = state.searchKeyword.toLowerCase().trim();
  const filter = state.activeFilter;

  const filtered = state.icons.filter(item => {
    if (filter === "native" && !item.nativeInstalled) return false;
    if (filter === "shortcut" && item.nativeInstalled) return false;
    if (!keyword) return true;
    const text = `${item.fndata_Title} ${item.fndata_Lan} ${item.fndata_Wan} ${item.appname}`.toLowerCase();
    return text.includes(keyword);
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-dim);">
        <i class="fa fa-folder-open-o" style="font-size: 2.5rem; margin-bottom: 0.8rem; opacity: 0.4;"></i>
        <div>没有找到匹配的图标，点击右上角「添加图标」开始创建</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(item => {
    let imgSrc = item.fndata_LanPic || "";
    if (imgSrc.startsWith("/deskdata")) {
      const stamp = item.updatedAt || Date.now();
      imgSrc = `${API_BASE.replace(/\/api$/, "")}${imgSrc}?t=${stamp}`;
    }
    const isNative = Boolean(item.nativeInstalled);
    const tag = isNative
      ? `<span class="icon-tag-native"><i class="fa fa-cube"></i> 飞牛原生</span>`
      : `<span class="icon-tag-shortcut"><i class="fa fa-link"></i> 桌面快捷</span>`;

    return `
      <div class="icon-card">
        <img class="icon-thumb" src="${imgSrc}" alt="${item.fndata_Title}" onerror="this.src='favicon.ico'">
        <div class="icon-info">
          <div class="icon-title">
            <span>${item.fndata_Title}</span>
            ${tag}
          </div>
          <div class="icon-meta" title="内网: ${item.fndata_Lan || "未配置"} | 外网: ${item.fndata_Wan || "未配置"}">
            内网: ${item.fndata_Lan || "未配置"}${item.fndata_Wan ? ` · 外网: ${item.fndata_Wan}` : ""}
          </div>
        </div>
        <div class="icon-actions">
          <button class="btn btn-secondary btn-icon btn-sm" onclick="openIconPreview('${item.id}')" title="打开/测试访问">
            <i class="fa fa-external-link"></i>
          </button>
          <button class="btn btn-secondary btn-icon btn-sm" onclick="editIcon(${item.id})" title="编辑图标">
            <i class="fa fa-pencil"></i>
          </button>
          <button class="btn btn-secondary btn-icon btn-sm" style="color: var(--danger);" onclick="deleteIcon(${item.id})" title="删除">
            <i class="fa fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function openIconPreview(id) {
  const item = state.icons.find(i => String(i.id) === String(id));
  if (!item) return;
  if (isWanAccess() && !item.fndata_Wan && window.location.hostname.includes("fnconnect.com")) {
    showToast("当前处于飞牛ID远程访问下，该应用未配置公网外部地址，外网无法直连局域网端口", "warning");
  }
  const finalUrl = resolveDesktopUrl(item);
  if (finalUrl) window.open(finalUrl, "_blank");
}

function openAddIconModal() {
  document.getElementById("iconForm").reset();
  document.getElementById("fieldId").value = "";
  document.getElementById("fieldLanPic").value = "";
  document.getElementById("fieldIconDataUrl").value = "";
  document.getElementById("fieldAppname").value = "";
  document.getElementById("editModalTitle").innerHTML = `<i class="fa fa-crop" style="color: var(--accent);"></i> 添加应用图标`;
  
  // 默认不勾选飞牛原生应用注入
  state.editingNative = false;
  document.getElementById("fieldGenerateNative").checked = false;

  state.cropper.image = null;
  state.cropper.rawSource = null;
  state.cropper.hasRawSource = false;
  state.cropper.isModified = false;
  state.cropper.isExistingIcon = false;
  state.cropper.scale = 1.0;
  state.cropper.panX = 0;
  state.cropper.panY = 0;
  state.cropper.rotation = 0;
  state.cropper.bgColor = "transparent";
  state.cropper.mode = "image";
  state.cropper.text = "";
  state.cropper.fontSize = 64;
  state.cropper.fontColor = "#ffffff";

  setCropperMode("image", false);
  const txtInput = document.getElementById("fieldTextContent");
  if (txtInput) txtInput.value = "";
  const szInput = document.getElementById("fieldTextSize");
  if (szInput) szInput.value = 64;
  const szBadge = document.getElementById("textSizeBadge");
  if (szBadge) szBadge.textContent = "64px";
  const urlInput = document.getElementById("fieldOnlineImgUrl");
  if (urlInput) urlInput.value = "";
  const urlBar = document.getElementById("onlineUrlBar");
  if (urlBar) urlBar.style.display = "none";

  const sel = document.getElementById("dockerSelect");
  if (sel) sel.value = "";

  renderCropCanvas();
  initPaletteDots();
  openModal("editModal");
}

function editIcon(id) {
  const item = state.icons.find(i => String(i.id) === String(id));
  if (!item) return;

  document.getElementById("iconForm").reset();

  document.getElementById("fieldId").value = item.id;
  document.getElementById("fieldTitle").value = item.fndata_Title || "";
  document.getElementById("fieldLan").value = item.fndata_Lan || "";
  document.getElementById("fieldWan").value = item.fndata_Wan || "";
  document.getElementById("fieldOpenInPage").value = item.OpenInPage !== undefined ? item.OpenInPage : 0;
  document.getElementById("fieldProtocol").value = item.fndata_Protocol !== undefined ? item.fndata_Protocol : 0;
  document.getElementById("fieldLanPic").value = item.fndata_LanPic || "";
  document.getElementById("fieldAppname").value = item.appname || "";
  
  // 原生应用复选框：不默认勾选！仅当原本就是原生应用时才勾选
  state.editingNative = Boolean(item.nativeInstalled || item.fnAppicon === 1);
  document.getElementById("fieldGenerateNative").checked = state.editingNative;
  
  document.getElementById("editModalTitle").innerHTML = `<i class="fa fa-crop" style="color: var(--accent);"></i> 编辑应用图标: ${escapeHtml(item.fndata_Title)}`;

  // 回显裁切、底色与文字图标设置
  const cs = item.cropSettings || {};
  state.cropper.isModified = false;
  state.cropper.mode = cs.mode || "image";
  state.cropper.panX = cs.panX || 0;
  state.cropper.panY = cs.panY || 0;
  state.cropper.rotation = cs.rotation || 0;
  state.cropper.bgColor = cs.bgColor || "transparent";
  state.cropper.text = cs.text || (cs.mode === "text" ? item.fndata_Title : "");
  state.cropper.fontSize = cs.fontSize || 64;
  state.cropper.fontColor = cs.fontColor || "#ffffff";

  setCropperMode(state.cropper.mode, false);
  const txtInput = document.getElementById("fieldTextContent");
  if (txtInput) txtInput.value = state.cropper.text;
  const szInput = document.getElementById("fieldTextSize");
  if (szInput) szInput.value = state.cropper.fontSize;
  const szBadge = document.getElementById("textSizeBadge");
  if (szBadge) szBadge.textContent = state.cropper.fontSize + "px";
  const urlInput = document.getElementById("fieldOnlineImgUrl");
  if (urlInput) urlInput.value = "";
  const urlBar = document.getElementById("onlineUrlBar");
  if (urlBar) urlBar.style.display = "none";

  document.querySelectorAll(".font-color-dot").forEach(d => {
    d.classList.toggle("active", d.dataset.color === state.cropper.fontColor);
  });

  // 自动匹配已选择的 Docker 容器
  const sel = document.getElementById("dockerSelect");
  if (sel) {
    sel.value = "";
    const matched = state.dockerContainers.find(c =>
      (c.hostPort && String(c.hostPort) === String(item.fndata_Lan)) ||
      (c.name && c.name.toLowerCase() === (item.fndata_Title || "").toLowerCase())
    );
    if (matched) {
      sel.value = matched.name;
    }
  }

  // 关键：优先载入无损原始图 (rawPic)，应用已保存的 scale/pan/bgColor，避免多次编辑时图标指数级放大与裁切边缘不可逆丢失
  const rawPic = item.fndata_RawPic || "";
  if (rawPic) {
    state.cropper.hasRawSource = true;
    state.cropper.isExistingIcon = false;
    state.cropper.scale = cs.scale !== undefined ? cs.scale : 1.0;
    state.cropper.rawSource = rawPic;
    let src = rawPic;
    if (src.startsWith("/deskdata")) {
      const stamp = item.updatedAt || Date.now();
      src = `${API_BASE.replace(/\/api$/, "")}${src}?t=${stamp}`;
    }
    loadCropperImage(src, false, true);
  } else {
    // 兼容历史旧数据：直接载入已有成型图标，锁定缩放倍率为 1.0，防止二次放大变形
    state.cropper.hasRawSource = false;
    state.cropper.isExistingIcon = true;
    state.cropper.scale = 1.0;
    state.cropper.rawSource = null;
    let src = item.fndata_LanPic || "";
    if (src.startsWith("/deskdata")) {
      const stamp = item.updatedAt || Date.now();
      src = `${API_BASE.replace(/\/api$/, "")}${src}?t=${stamp}`;
    }
    loadCropperImage(src, true, false);
  }

  initPaletteDots();
  openModal("editModal");
}

async function deleteIcon(id) {
  if (!confirm("确定要删除该图标吗？若已生成飞牛原生套件将同步从系统卸载。")) return;
  try {
    await fetchApi(`/icons/${id}`, { method: "DELETE" });
    showToast("图标已删除，桌面已同步！", "success");
    loadIcons();
    markDesktopDirty(false);
  } catch (err) {
    showToast("删除失败: " + err.message, "error");
  }
}

// 嗅探抓取 Favicon
async function handleSniffFavicon() {
  const portOrUrl = document.getElementById("fieldLan").value.trim() || document.getElementById("fieldWan").value.trim();
  const title = document.getElementById("fieldTitle").value.trim();
  if (!portOrUrl) {
    return showToast("请先填写局域网端口或访问地址", "error");
  }

  const btn = document.getElementById("btnSniffFavicon");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> <span>抓取中...</span>`;

  try {
    const res = await fetchApi("/fetch-favicon", {
      method: "POST",
      body: JSON.stringify({ url: portOrUrl, title })
    });
    if (res.dataUrl) {
      setCropperMode("image", false);
      state.cropper.isModified = true;
      state.cropper.isExistingIcon = false;
      state.cropper.hasRawSource = true;
      state.cropper.rawSource = res.dataUrl;
      state.cropper.scale = 1.0;
      state.cropper.panX = 0;
      state.cropper.panY = 0;
      state.cropper.rotation = 0;
      loadCropperImage(res.dataUrl, false, true);
      showToast("图标探测成功！", "success");
    }
  } catch (err) {
    showToast(err.message || "未能抓取到图标，可直接上传图片", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa fa-globe"></i> <span>自动抓取</span>`;
  }
}

// 保存图标
async function saveIcon() {
  const title = document.getElementById("fieldTitle").value.trim();
  if (!title) return showToast("请输入应用名称", "error");

  const isEdit = Boolean(document.getElementById("fieldId").value);
  const targetId = isEdit ? parseInt(document.getElementById("fieldId").value, 10) : undefined;

  const payload = {
    id: targetId,
    fndata_Title: title,
    fndata_Lan: document.getElementById("fieldLan").value.trim(),
    fndata_Wan: document.getElementById("fieldWan").value.trim(),
    OpenInPage: parseInt(document.getElementById("fieldOpenInPage").value, 10),
    fndata_Protocol: parseInt(document.getElementById("fieldProtocol").value, 10),
    generateNative: document.getElementById("fieldGenerateNative").checked,
    fndata_LanPic: document.getElementById("fieldLanPic").value || "",
    fndata_RawPic: isEdit ? (state.icons.find(i => String(i.id) === String(targetId))?.fndata_RawPic || "") : "",
    appname: document.getElementById("fieldAppname").value || undefined,
    cropSettings: {
      mode: state.cropper.mode || "image",
      text: state.cropper.text || "",
      fontSize: state.cropper.fontSize || 64,
      fontColor: state.cropper.fontColor || "#ffffff",
      scale: state.cropper.scale,
      panX: state.cropper.panX,
      panY: state.cropper.panY,
      rotation: state.cropper.rotation,
      bgColor: state.cropper.bgColor
    }
  };

  // 关键：若为文字图标、新上传/抓取/微调了图标，或新建图标时，导出并发送 iconDataUrl 与 rawIconDataUrl
  if (!isEdit || state.cropper.isModified || state.cropper.mode === "text" || !payload.fndata_LanPic) {
    const canvas = document.getElementById("studioCanvas");
    payload.iconDataUrl = canvas.toDataURL("image/png");
    if (state.cropper.rawSource && state.cropper.rawSource.startsWith("data:")) {
      payload.rawIconDataUrl = state.cropper.rawSource;
    }
  }

  // 记录原生应用勾选状态是否发生变化，用于保存后自动重挂桌面避免图标重复
  const prevNative = isEdit ? Boolean(state.editingNative) : false;

  const btn = document.getElementById("btnSaveIcon");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> <span>保存中...</span>`;

  try {
    await fetchApi("/icons", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    // 原生应用与快捷方式即时生效，桌面直接同步
    if (payload.generateNative) {
      showToast("已保存并即时生成飞牛原生应用，桌面已同步就绪！", "success");
    } else {
      showToast("应用配置保存成功，桌面已即时生效！", "success");
    }
    closeModal("editModal");
    loadIcons();
    markDesktopDirty(false);
  } catch (err) {
    showToast("保存失败: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `完成保存`;
  }
}

// ==================== WeTab 桌面卡片组件管理 ====================
async function loadWidgets() {
  try {
    const data = await fetchApi("/widgets");
    state.widgets = data.widgets || [];
    renderWidgets();
    updateStats();
  } catch (err) {
    console.warn("获取卡片小组件失败:", err.message);
  }
}

function renderWidgets() {
  const grid = document.getElementById("widgetAdminGrid");
  if (!grid) return;
  if (state.widgets.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-dim);">
        <i class="fa fa-cubes" style="font-size: 2.5rem; margin-bottom: 0.8rem; opacity: 0.4;"></i>
        <div>暂未添加桌面卡片，点击上方「添加小组件卡片」丰富你的飞牛桌面</div>
      </div>
    `;
    return;
  }

  const typeLabels = {
    weather: "⛅ 实时天气",
    countdown: "⏳ 倒计时/纪念日",
    clock: "🕒 数字时钟",
    notes: "📝 便签备忘"
  };
  const sizeLabels = {
    small: "小 (1x1)",
    medium: "中 (2x1)",
    large: "大 (2x2)"
  };

  grid.innerHTML = state.widgets.map(w => {
    return `
      <div class="widget-admin-card">
        <div class="widget-admin-top">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="widget-type-badge">${typeLabels[w.type] || w.type}</span>
            <span class="widget-size-tag">${sizeLabels[w.size] || w.size}</span>
          </div>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary btn-icon btn-xs" onclick="editWidget(${w.id})" title="编辑">
              <i class="fa fa-pencil"></i>
            </button>
            <button class="btn btn-secondary btn-icon btn-xs" style="color: var(--danger);" onclick="deleteWidget(${w.id})" title="删除">
              <i class="fa fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="widget-preview-wrapper">
          ${renderStaticWidgetHtml(w)}
        </div>
      </div>
    `;
  }).join("");
}

function calcCountdown(targetDateStr) {
  const target = new Date(targetDateStr).getTime();
  const now = Date.now();
  const diff = target - now;
  if (isNaN(diff)) return { days: 0, hours: 0, mins: 0, secs: 0, isPast: false };
  if (diff <= 0) {
    const pastDays = Math.floor(Math.abs(diff) / (1000 * 60 * 60 * 24));
    return { days: pastDays, hours: 0, mins: 0, secs: 0, isPast: true };
  }
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  const secs = Math.floor((diff / 1000) % 60);
  return { days, hours, mins, secs, isPast: false };
}

const pad = n => String(n).padStart(2, "0");

function renderStaticWidgetHtml(w) {
  const size = w.size || "medium";
  const theme = w.theme || "glass";

  if (w.type === "weather") {
    const city = w.city || "北京";
    if (size === "small") {
      return `
        <div class="wetab-card wetab-card-small theme-${theme}">
          <div class="weather-inner">
            <div class="weather-header"><span>${city}</span><span>⛅</span></div>
            <div class="weather-main"><span class="weather-temp">22°</span><span class="weather-desc">晴间多云</span></div>
            <div class="weather-footer"><span>18°~27°</span><span>湿度 45%</span></div>
          </div>
        </div>
      `;
    } else if (size === "large") {
      return `
        <div class="wetab-card wetab-card-large theme-${theme}">
          <div class="weather-inner" style="gap: 12px;">
            <div class="weather-header" style="font-size: 15px;"><span>${city} 天气概况</span><span style="font-size: 22px;">⛅</span></div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div class="weather-temp" style="font-size: 48px;">22°</div>
              <div style="text-align: right;">
                <div style="font-size: 15px; font-weight: 600;">晴间多云</div>
                <div style="font-size: 12px; opacity: 0.75; margin-top: 4px;">今日 18° ~ 27°</div>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
              <div class="weather-pill">💧 湿度: 45%</div>
              <div class="weather-pill">💨 风况: 微风</div>
              <div class="weather-pill">🌡️ 体感: 23°</div>
              <div class="weather-pill">🍃 空气: 优良</div>
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="wetab-card wetab-card-medium theme-${theme}">
          <div class="weather-inner" style="flex-direction: row; align-items: center; justify-content: space-between;">
            <div>
              <div class="weather-header" style="margin-bottom: 6px;"><span>${city}</span><span style="margin-left: 6px;">⛅</span></div>
              <div class="weather-main"><span class="weather-temp">22°</span><span class="weather-desc">晴间多云</span></div>
            </div>
            <div class="weather-med-right">
              <span class="weather-pill">🌡️ 18° ~ 27°</span>
              <span class="weather-pill">💧 湿度 45%</span>
              <span class="weather-pill">💨 微风</span>
            </div>
          </div>
        </div>
      `;
    }
  }

  if (w.type === "countdown") {
    const cd = calcCountdown(w.targetDate || "2026-10-01T00:00");
    const targetStr = (w.targetDate || "2026-10-01").split("T")[0];
    if (size === "small") {
      return `
        <div class="wetab-card wetab-card-small theme-${theme}">
          <div class="cd-inner">
            <div class="cd-title">${w.title || "目标倒计时"}</div>
            <div class="cd-center"><span class="cd-days">${cd.days}</span><span class="cd-unit">天</span></div>
            <div class="cd-footer">${cd.isPast ? "已过去" : "倒计时"}</div>
          </div>
        </div>
      `;
    } else if (size === "large") {
      return `
        <div class="wetab-card wetab-card-large theme-${theme}">
          <div class="cd-inner" style="gap: 12px;">
            <div class="weather-header" style="font-size: 15px;">
              <span class="cd-title">${w.title || "目标倒计时"}</span>
              <span style="font-size: 18px;">⏳</span>
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin: auto 0;">
              <div style="display: flex; align-items: baseline; gap: 6px;">
                <span class="cd-days" style="font-size: 56px;">${cd.days}</span>
                <span class="cd-unit" style="font-size: 18px;">天</span>
              </div>
              <div class="cd-time-bar" style="margin-top: 8px; font-size: 13px; padding: 4px 12px;">
                ${pad(cd.hours)} 时 ${pad(cd.mins)} 分 ${pad(cd.secs)} 秒
              </div>
            </div>
            <div class="cd-footer" style="text-align: center;">目标: ${targetStr}</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="wetab-card wetab-card-medium theme-${theme}">
          <div class="cd-inner">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="cd-title">${w.title || "目标倒计时"}</div>
              <div style="font-size: 11px; opacity: 0.7;">${cd.isPast ? "已过" : "剩余"}</div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin: auto 0;">
              <div style="display: flex; align-items: baseline; gap: 4px;">
                <span class="cd-days">${cd.days}</span>
                <span class="cd-unit">天</span>
              </div>
              <div class="cd-time-bar">${pad(cd.hours)}:${pad(cd.mins)}:${pad(cd.secs)}</div>
            </div>
            <div class="cd-footer">${targetStr}</div>
          </div>
        </div>
      `;
    }
  }

  if (w.type === "clock") {
    const now = new Date();
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const secStr = pad(now.getSeconds());
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 星期${["日","一","二","三","四","五","六"][now.getDay()]}`;

    if (size === "small") {
      return `
        <div class="wetab-card wetab-card-small theme-${theme}">
          <div class="clock-inner">
            <div class="clock-time">${timeStr}<span class="clock-sec">${secStr}</span></div>
            <div class="clock-date">${dateStr}</div>
          </div>
        </div>
      `;
    } else if (size === "large") {
      return `
        <div class="wetab-card wetab-card-large theme-${theme}">
          <div class="clock-inner" style="justify-content: space-around;">
            <div style="font-size: 14px; opacity: 0.85;">${now.getFullYear()} 年</div>
            <div class="clock-time" style="font-size: 46px;">${timeStr}<span class="clock-sec" style="font-size: 20px;">${secStr}</span></div>
            <div class="clock-date" style="font-size: 14px; font-weight: 600;">${dateStr}</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="wetab-card wetab-card-medium theme-${theme}">
          <div class="clock-inner">
            <div class="clock-time" style="font-size: 38px;">${timeStr}<span class="clock-sec">${secStr}</span></div>
            <div class="clock-date" style="font-size: 13px;">${dateStr}</div>
          </div>
        </div>
      `;
    }
  }

  // notes
  return `
    <div class="wetab-card wetab-card-${size} theme-${theme}">
      <div class="notes-inner" style="padding: 10px;">
        <div class="notes-title">📌 ${w.title || "便签备忘"}</div>
        <div class="notes-content">${w.content || "写下待办事项或灵感备忘..."}</div>
      </div>
    </div>
  `;
}

function openAddWidgetModal() {
  state.widgetForm = {
    id: null,
    type: "weather",
    size: "medium",
    title: "",
    targetDate: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 16),
    city: "北京",
    theme: "glass",
    style: "digital",
    content: ""
  };
  updateWidgetFormInputs();
  renderWidgetLivePreview();
  openModal("widgetModal");
}

function editWidget(id) {
  const w = state.widgets.find(item => item.id === id);
  if (!w) return;
  state.widgetForm = { ...w };
  updateWidgetFormInputs();
  renderWidgetLivePreview();
  openModal("widgetModal");
}

function updateWidgetFormInputs() {
  const f = state.widgetForm;
  document.getElementById("widgetFieldId").value = f.id || "";
  document.getElementById("fieldWeatherCity").value = f.city || "北京";
  document.getElementById("fieldCdTitle").value = f.title || "";
  document.getElementById("fieldCdDate").value = f.targetDate || "";
  document.getElementById("fieldClockStyle").value = f.style || "digital";
  document.getElementById("fieldNotesTitle").value = f.title || "";
  document.getElementById("fieldNotesContent").value = f.content || "";
  document.getElementById("fieldWidgetTheme").value = f.theme || "glass";

  // 激活类型选择器
  document.querySelectorAll("#widgetTypeSelector .segmented-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === f.type);
  });
  // 激活尺寸选择器
  document.querySelectorAll("#widgetSizeSelector .segmented-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.size === f.size);
  });

  // 切换表单组显隐
  document.getElementById("groupWeather").style.display = f.type === "weather" ? "block" : "none";
  document.getElementById("groupCountdown").style.display = f.type === "countdown" ? "block" : "none";
  document.getElementById("groupClock").style.display = f.type === "clock" ? "block" : "none";
  document.getElementById("groupNotes").style.display = f.type === "notes" ? "block" : "none";
}

function renderWidgetLivePreview() {
  const container = document.getElementById("widgetLivePreviewWrapper");
  container.innerHTML = renderStaticWidgetHtml(state.widgetForm);
}

async function saveWidget() {
  const f = state.widgetForm;
  f.city = document.getElementById("fieldWeatherCity").value.trim();
  f.title = f.type === "countdown" ? document.getElementById("fieldCdTitle").value.trim() : document.getElementById("fieldNotesTitle").value.trim();
  f.targetDate = document.getElementById("fieldCdDate").value;
  f.style = document.getElementById("fieldClockStyle").value;
  f.content = document.getElementById("fieldNotesContent").value.trim();
  f.theme = document.getElementById("fieldWidgetTheme").value;

  try {
    await fetchApi("/widgets", {
      method: "POST",
      body: JSON.stringify(f)
    });
    showToast("小组件卡片已保存，桌面已即时生效！", "success");
    closeModal("widgetModal");
    loadWidgets();
    markDesktopDirty(false);
  } catch (err) {
    showToast("保存失败: " + err.message, "error");
  }
}

async function deleteWidget(id) {
  if (!confirm("确定要删除此桌面小组件卡片吗？")) return;
  try {
    await fetchApi(`/widgets/${id}`, { method: "DELETE" });
    showToast("小组件已删除，桌面已同步！", "success");
    loadWidgets();
    markDesktopDirty(false);
  } catch (err) {
    showToast("删除失败: " + err.message, "error");
  }
}

// ==================== Docker 容器嗅探 ====================
async function loadDockerContainers() {
  try {
    const data = await fetchApi("/docker/containers");
    state.dockerContainers = data.containers || [];
    document.getElementById("statDockerContainers").textContent = state.dockerContainers.length;

    const select = document.getElementById("dockerSelect");
    select.innerHTML = '<option value="">-- 选择运行中的 Docker 容器一键填入 --</option>';
    state.dockerContainers.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `${c.name} (${c.hostPort ? `:${c.hostPort}` : "无端口映射"})`;
      select.appendChild(opt);
    });
  } catch (_) {}
}

function handleDockerSelect(e) {
  const name = e.target.value;
  if (!name) return;
  const item = state.dockerContainers.find(c => c.name === name);
  if (!item) return;

  document.getElementById("fieldTitle").value = item.matchedBrand || item.name;
  if (item.hostPort) {
    document.getElementById("fieldLan").value = item.hostPort;
    handleSniffFavicon();
  } else if (item.lanUrl) {
    document.getElementById("fieldLan").value = item.lanUrl;
  }
  if (item.presetDataUrl) {
    loadCropperImage(item.presetDataUrl);
  }
}

// ==================== 统计与辅助 ====================
function updateStats() {
  document.getElementById("statTotalIcons").textContent = state.icons.length;
  document.getElementById("statNativeApps").textContent = state.icons.filter(i => i.nativeInstalled).length;
  document.getElementById("statTotalWidgets").textContent = state.widgets.length;
}

// ==================== 浅色 / 深色主题切换 ====================
const THEME_KEY = "fndesk_theme";

function applyTheme(theme) {
  const isLight = theme === "light";
  document.body.classList.toggle("theme-light", isLight);
  document.documentElement.classList.remove("theme-light-pre");

  const icon = document.getElementById("themeIcon");
  const label = document.getElementById("themeLabel");
  const btn = document.getElementById("btnThemeToggle");
  if (icon) icon.className = isLight ? "fa fa-sun-o" : "fa fa-moon-o";
  if (label) label.textContent = isLight ? "深色" : "浅色";
  if (btn) btn.title = isLight ? "当前浅色模式，点击切换为深色" : "当前深色模式，点击切换为浅色";

  try { localStorage.setItem(THEME_KEY, isLight ? "light" : "dark"); } catch (_) {}
}

function toggleTheme() {
  applyTheme(document.body.classList.contains("theme-light") ? "dark" : "light");
}

function initTheme() {
  let saved = "dark";
  try { saved = localStorage.getItem(THEME_KEY) || "dark"; } catch (_) {}
  applyTheme(saved);
}

// ==================== 待生效状态提示 ====================
// 保存配置后并不立即挂载桌面，仅做「有未生效改动」标记，等待用户手动点击「立即生效」统一应用。
function markDesktopDirty(dirty) {
  state.desktopDirty = Boolean(dirty);
  const btn = document.getElementById("btnApplyDesktop");
  if (!btn) return;
  if (state.desktopDirty) {
    btn.classList.add("is-dirty");
    btn.innerHTML = `<i class="fa fa-bolt"></i> <span>立即生效</span><span class="apply-dirty-dot"></span>`;
    btn.title = "有未生效的改动，点击应用到飞牛桌面";
  } else {
    btn.classList.remove("is-dirty");
    btn.innerHTML = `<i class="fa fa-bolt"></i> <span>立即生效</span>`;
    btn.title = "将配置好的小组件和快捷图标立即挂载到飞牛桌面";
  }
}

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("active");
  const modalBody = el.querySelector(".modal-body");
  if (modalBody) modalBody.scrollTop = 0;
  const innerModal = el.querySelector(".modal");
  if (innerModal) innerModal.scrollTop = 0;
}
function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

function showLoginModal() {
  openModal("loginModal");
}

// ==================== 初始化事件监听 ====================
document.addEventListener("DOMContentLoaded", () => {
  // 基础数据加载
  ensureLanIp();
  loadIcons();
  loadWidgets();
  loadDockerContainers();
  checkDesktopStatus();

  // 主题初始化与切换
  initTheme();
  document.getElementById("btnThemeToggle").onclick = toggleTheme;

  // 顶部操作栏
  document.getElementById("btnApplyDesktop").onclick = applyDesktop;
  document.getElementById("btnRestoreDesktop").onclick = () => openModal("restoreConfirmModal");
  document.getElementById("btnConfirmRestore").onclick = restoreDesktop;
  document.getElementById("btnCancelRestore").onclick = () => closeModal("restoreConfirmModal");
  document.getElementById("btnCloseRestoreModal").onclick = () => closeModal("restoreConfirmModal");


  document.getElementById("btnSettings").onclick = () => openModal("settingsModal");
  document.getElementById("btnCloseSettings").onclick = () => closeModal("settingsModal");
  document.getElementById("btnCancelSettings").onclick = () => closeModal("settingsModal");

  // 主视图 Tab 切换
  document.querySelectorAll("#mainTabs .segmented-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#mainTabs .segmented-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("tabViewIcons").style.display = tab === "icons" ? "block" : "none";
      document.getElementById("tabViewWidgets").style.display = tab === "widgets" ? "block" : "none";
    };
  });

  // 添加图标
  document.getElementById("btnAddIcon").onclick = openAddIconModal;
  document.getElementById("btnCloseEditModal").onclick = () => closeModal("editModal");
  document.getElementById("btnCancelEdit").onclick = () => closeModal("editModal");
  document.getElementById("btnSaveIcon").onclick = saveIcon;

  // 添加卡片小组件
  document.getElementById("btnAddWidget").onclick = openAddWidgetModal;
  document.getElementById("btnAddNewWidget").onclick = openAddWidgetModal;
  document.getElementById("btnCloseWidgetModal").onclick = () => closeModal("widgetModal");
  document.getElementById("btnCancelWidget").onclick = () => closeModal("widgetModal");
  document.getElementById("btnSaveWidget").onclick = saveWidget;

  // 小组件类型与尺寸切换
  document.querySelectorAll("#widgetTypeSelector .segmented-btn").forEach(btn => {
    btn.onclick = () => {
      state.widgetForm.type = btn.dataset.type;
      updateWidgetFormInputs();
      renderWidgetLivePreview();
    };
  });
  document.querySelectorAll("#widgetSizeSelector .segmented-btn").forEach(btn => {
    btn.onclick = () => {
      state.widgetForm.size = btn.dataset.size;
      updateWidgetFormInputs();
      renderWidgetLivePreview();
    };
  });
  document.getElementById("fieldWidgetTheme").onchange = e => {
    state.widgetForm.theme = e.target.value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldWeatherCity").oninput = e => {
    state.widgetForm.city = e.target.value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldCdTitle").oninput = e => {
    state.widgetForm.title = e.target.value;
    renderWidgetLivePreview();
  };

  // 图标工坊模式切换 (图片 / 文字)
  document.getElementById("tabModeImage").onclick = () => setCropperMode("image");
  document.getElementById("tabModeText").onclick = () => setCropperMode("text");

  // 在线图片 URL 展开与确认加载
  document.getElementById("btnOnlineImage").onclick = () => {
    const bar = document.getElementById("onlineUrlBar");
    if (bar.style.display === "none" || !bar.style.display) {
      bar.style.display = "flex";
      document.getElementById("fieldOnlineImgUrl").focus();
    } else {
      bar.style.display = "none";
    }
  };
  document.getElementById("btnConfirmOnlineUrl").onclick = () => handleLoadOnlineUrl();
  document.getElementById("fieldOnlineImgUrl").onkeydown = e => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleLoadOnlineUrl();
    }
  };

  // 文字图标输入监听（自动实时显示）
  const fieldTextContent = document.getElementById("fieldTextContent");
  if (fieldTextContent) {
    fieldTextContent.oninput = e => {
      state.cropper.text = e.target.value;
      state.cropper.isModified = true;
      renderCropCanvas();
    };
  }

  // 标题输入框实时联动文字图标（若尚未定制文字）
  const fieldTitle = document.getElementById("fieldTitle");
  if (fieldTitle) {
    fieldTitle.addEventListener("input", e => {
      if (state.cropper.mode === "text" && (!state.cropper.text || state.cropper.text === state.lastAutoTitle)) {
        state.cropper.text = e.target.value;
        state.lastAutoTitle = e.target.value;
        if (fieldTextContent) fieldTextContent.value = e.target.value;
        renderCropCanvas();
      }
    });
  }

  // 文字大小滑块调节
  const fieldTextSize = document.getElementById("fieldTextSize");
  if (fieldTextSize) {
    fieldTextSize.oninput = e => {
      const sz = parseInt(e.target.value, 10);
      state.cropper.fontSize = sz;
      const badge = document.getElementById("textSizeBadge");
      if (badge) badge.textContent = `${sz}px`;
      state.cropper.isModified = true;
      renderCropCanvas();
    };
  }

  // 文字预设颜色点击
  document.querySelectorAll(".font-color-dot").forEach(dot => {
    dot.onclick = () => {
      document.querySelectorAll(".font-color-dot").forEach(d => d.classList.remove("active"));
      dot.classList.add("active");
      state.cropper.fontColor = dot.dataset.color;
      state.cropper.isModified = true;
      renderCropCanvas();
    };
  });

  // 自定义文字颜色选择器
  const fieldFontColorCustom = document.getElementById("fieldFontColorCustom");
  if (fieldFontColorCustom) {
    fieldFontColorCustom.oninput = e => {
      document.querySelectorAll(".font-color-dot").forEach(d => d.classList.remove("active"));
      state.cropper.fontColor = e.target.value;
      state.cropper.isModified = true;
      renderCropCanvas();
    };
  }

  // 全局/模态框剪贴板粘贴监听 (支持直接 Ctrl+V 粘贴图片或网络图片链接)
  document.addEventListener("paste", async e => {
    const modal = document.getElementById("editModal");
    if (!modal || !modal.classList.contains("is-open")) return;

    const target = e.target;
    const isTextInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

    // 1. 优先检测剪贴板中的图片文件 (截屏、复制的图片等)
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = ev => {
              setCropperMode("image", false);
              state.cropper.isModified = true;
              state.cropper.isExistingIcon = false;
              state.cropper.hasRawSource = true;
              state.cropper.rawSource = ev.target.result;
              state.cropper.scale = 1.0;
              state.cropper.panX = 0;
              state.cropper.panY = 0;
              state.cropper.rotation = 0;
              loadCropperImage(ev.target.result, false, true);
              showToast("已成功粘贴剪贴板图片！", "success");
            };
            reader.readAsDataURL(file);
            e.preventDefault();
            return;
          }
        }
      }
    }

    // 2. 如果剪贴板是网络图片地址或 data: 链接
    const text = e.clipboardData?.getData("text")?.trim();
    if (text) {
      if (/^https?:\/\/.+\.(png|jpe?g|svg|webp|ico|gif|bmp)(\?.*)?$/i.test(text) ||
          text.startsWith("data:image/") ||
          (/^https?:\/\//i.test(text) && (!isTextInput || target.id === "fieldOnlineImgUrl"))) {
        e.preventDefault();
        const inputEl = document.getElementById("fieldOnlineImgUrl");
        if (inputEl) inputEl.value = text;
        const bar = document.getElementById("onlineUrlBar");
        if (bar) bar.style.display = "flex";
        handleLoadOnlineUrl(text);
      }
    }
  });

  // 图标工坊与 Favicon 抓取
  document.getElementById("btnSniffFavicon").onclick = handleSniffFavicon;
  document.getElementById("dockerSelect").onchange = handleDockerSelect;

  document.getElementById("btnUploadLocal").onclick = () => {
    document.getElementById("localFileInput").click();
  };
  document.getElementById("localFileInput").onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setCropperMode("image", false);
      state.cropper.isModified = true;
      state.cropper.isExistingIcon = false;
      state.cropper.hasRawSource = true;
      state.cropper.rawSource = ev.target.result;
      state.cropper.scale = 1.0;
      state.cropper.panX = 0;
      state.cropper.panY = 0;
      state.cropper.rotation = 0;
      loadCropperImage(ev.target.result, false, true);
      showToast("本地图片已加载！", "success");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // 搜索与过滤
  document.getElementById("searchInput").oninput = e => {
    state.searchKeyword = e.target.value;
    renderIcons();
  };
  document.querySelectorAll("#filterSegment .segmented-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#filterSegment .segmented-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeFilter = btn.dataset.filter;
      renderIcons();
    };
  });

  // 小组件表单实时响应预览
  document.getElementById("fieldCdDate").oninput = () => {
    state.widgetForm.targetDate = document.getElementById("fieldCdDate").value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldClockStyle").onchange = () => {
    state.widgetForm.style = document.getElementById("fieldClockStyle").value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldNotesTitle").oninput = () => {
    state.widgetForm.title = document.getElementById("fieldNotesTitle").value;
    renderWidgetLivePreview();
  };
  document.getElementById("fieldNotesContent").oninput = () => {
    state.widgetForm.content = document.getElementById("fieldNotesContent").value;
    renderWidgetLivePreview();
  };

  // 局域网输入框失去焦点时智能自动探测 Favicon
  document.getElementById("fieldLan").addEventListener("blur", () => {
    const val = document.getElementById("fieldLan").value.trim();
    if (val && !state.cropper.image) {
      handleSniffFavicon();
    }
  });

  // 刷新按钮增强
  document.getElementById("btnRefresh").onclick = async () => {
    const icon = document.getElementById("refreshIcon");
    if (icon) icon.classList.add("spin");
    try {
      await Promise.all([
        loadIcons(),
        loadWidgets(),
        loadDockerContainers(),
        checkDesktopStatus()
      ]);
      showToast("数据已刷新", "success");
    } catch (e) {
      showToast("刷新数据: " + (e.message || "已同步"), "info");
    } finally {
      if (icon) icon.classList.remove("spin");
    }
  };

  // 挂载全局方法确保 inline onclick 100% 可调用
  window.editIcon = editIcon;
  window.deleteIcon = deleteIcon;
  window.editWidget = editWidget;
  window.deleteWidget = deleteWidget;

  // 初始化画布拖拽平移与滚轮缩放事件
  initCanvasEvents();

  // 支持 URL 参数直达 Tab 或弹窗（便于联动与自动化测试）
  const params = new URLSearchParams(window.location.search);
  if (params.get("tab") === "widgets") {
    const wBtn = document.querySelector('button[data-tab="widgets"]');
    if (wBtn) wBtn.click();
  }
  if (params.get("modal") === "edit") {
    openAddIconModal();
  } else if (params.get("modal") === "widget") {
    openAddWidgetModal();
  }
});
