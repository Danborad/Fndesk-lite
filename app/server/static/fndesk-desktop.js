/**
 * Fndesk Lite - 飞牛桌面快捷方式图标挂载引擎
 * 纯原生 JS 实现，无侵入式安全注入，支持一键还原
 */
(function() {
  if (window.__FNDESK_DESKTOP_LOADED__) return;
  window.__FNDESK_DESKTOP_LOADED__ = true;

  console.log("[Fndesk Desktop] 挂载引擎已启动...");

  // 智能识别飞牛二级路径前缀（如通过飞牛 ID 远程访问时路径为 /n12345/）
  const PATH_PREFIX = (function() {
    const path = window.location.pathname || "";
    const m = path.match(/^(\/[a-zA-Z0-9_-]+)(?:\/.*)?$/);
    if (m) {
      const firstSeg = m[1];
      if (!["/cgi", "/api", "/app", "/assets", "/static", "/login", "/biz", "/desktop", "/file", "/photos"].includes(firstSeg.toLowerCase())) {
        return firstSeg;
      }
    }
    return "";
  })();

  // 基础 API 地址识别
  const API_BASE = (function() {
    if (window.location.port === "9990") return "/api";
    return `${PATH_PREFIX}/cgi/ThirdParty/fndesk/index.cgi/api`;
  })();

  // 注入全局样式
  function injectStyles() {
    if (document.getElementById("fndesk-desktop-styles")) return;
    const style = document.createElement("style");
    style.id = "fndesk-desktop-styles";
    style.textContent = `
      /* 窗口化 iframe 弹窗 */
      .fndesk-win {
        position: fixed;
        z-index: 99999;
        background: rgba(18, 26, 44, 0.85);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 14px;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .fndesk-win-header {
        height: 40px;
        background: rgba(13, 19, 33, 0.9);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        cursor: move;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        user-select: none;
      }
      .fndesk-win-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
      }
      .fndesk-win-title img {
        width: 20px;
        height: 20px;
        border-radius: 4px;
      }
      .fndesk-win-tools {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fndesk-win-btn {
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: transparent;
        color: #cbd5e1;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.15s ease;
      }
      .fndesk-win-btn:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
      }
      .fndesk-win-btn.btn-close:hover {
        background: #ef4444;
        color: #fff;
      }
      .fndesk-win-body {
        flex: 1;
        position: relative;
        background: #fff;
      }
      .fndesk-win-body iframe {
        width: 100%;
        height: 100%;
        border: none;
      }
      .fndesk-win-resizer {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 18px;
        height: 18px;
        cursor: se-resize;
      }
    `;
    document.head.appendChild(style);
  }

  // 辅助请求函数
  async function apiGet(endpoint) {
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`[Fndesk] GET ${endpoint} 失败:`, e.message);
      return null;
    }
  }

  // 回环地址探测：桌面页可能通过 localhost / 127.0.0.1 打开，
  // 此时必须使用服务端返回的 NAS 局域网 IP，避免快捷方式指向客户端自己的 localhost。
  let cachedLanIp = "";
  let lanIpProbeAttempts = 0;

  function isLoopbackHost(host) {
    return !host || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
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

  async function ensureLanIp() {
    if (cachedLanIp) return cachedLanIp;
    const status = await apiGet("/status");
    if (status && status.lanIp && !isLoopbackHost(status.lanIp)) {
      cachedLanIp = status.lanIp;
    }
    return cachedLanIp;
  }

  // 打开在页内窗口中的 iframe
  let windowZIndex = 9999;
  function openIframeWindow(url, title, icon) {
    const winId = `fndesk-win-${Date.now()}`;
    const win = document.createElement("div");
    win.className = "fndesk-win";
    win.id = winId;
    windowZIndex++;
    win.style.zIndex = windowZIndex;
    win.style.width = "900px";
    win.style.height = "620px";
    win.style.left = `${Math.max(40, (window.innerWidth - 900) / 2)}px`;
    win.style.top = `${Math.max(40, (window.innerHeight - 620) / 2)}px`;

    win.innerHTML = `
      <div class="fndesk-win-header">
        <div class="fndesk-win-title">
          ${icon ? `<img src="${icon}" onerror="this.style.display='none'">` : ""}
          <span>${title || "应用查看"}</span>
        </div>
        <div class="fndesk-win-tools">
          <div class="fndesk-win-btn btn-refresh" title="刷新">↻</div>
          <div class="fndesk-win-btn btn-min" title="最小化">−</div>
          <div class="fndesk-win-btn btn-close" title="关闭">✕</div>
        </div>
      </div>
      <div class="fndesk-win-body">
        <iframe src="${url}"></iframe>
      </div>
      <div class="fndesk-win-resizer"></div>
    `;

    document.body.appendChild(win);

    // 拖动窗口
    const header = win.querySelector(".fndesk-win-header");
    let isDragging = false, startX, startY, origLeft, origTop;
    header.addEventListener("mousedown", e => {
      if (e.target.closest(".fndesk-win-btn")) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = parseInt(win.style.left, 10);
      origTop = parseInt(win.style.top, 10);
      windowZIndex++;
      win.style.zIndex = windowZIndex;
      const onMove = ev => {
        if (!isDragging) return;
        win.style.left = `${origLeft + (ev.clientX - startX)}px`;
        win.style.top = `${origTop + (ev.clientY - startY)}px`;
      };
      const onUp = () => {
        isDragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    win.querySelector(".btn-close").addEventListener("click", () => win.remove());
    win.querySelector(".btn-refresh").addEventListener("click", () => {
      const iframe = win.querySelector("iframe");
      if (iframe) iframe.src = iframe.src;
    });
    win.querySelector(".btn-min").addEventListener("click", () => win.remove());
  }

  let cachedIcons = [];

  function formatTargetUrl(rawTarget, targetHost, proto) {
    if (!rawTarget) return "";
    const clean = rawTarget.trim().replace(/^:/, "");
    const formattedHost = (targetHost.includes(":") && !targetHost.startsWith("[")) ? `[${targetHost}]` : targetHost;
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
    return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1|\[?::1\]?)(?=[:/]|$)/i, `$1${formattedHost}`);
  }

  function extractPortAndPath(rawTarget, userProtocol) {
    let clean = String(rawTarget || "").trim();
    let proto = userProtocol === 2 ? "https" : (userProtocol === 1 ? "http" : "");
    let port = "";
    let pth = "/";

    if (!clean) {
      return { protocol: proto || "http", port: "", path: "/" };
    }

    if (/^https?:\/\//i.test(clean)) {
      try {
        const u = new URL(clean);
        proto = proto || u.protocol.replace(":", "");
        port = u.port || (u.protocol === "https:" ? "443" : "80");
        pth = (u.pathname + u.search + u.hash) || "/";
        if (!pth.startsWith("/")) pth = "/" + pth;
        return { protocol: proto, port: String(port), path: pth };
      } catch (e) {}
    }

    clean = clean.replace(/^:+/, "");

    const portMatch = clean.match(/^(\d{1,5})(\/.*)?$/);
    if (portMatch) {
      port = portMatch[1];
      pth = portMatch[2] || "/";
      if (!pth.startsWith("/")) pth = "/" + pth;
      return { protocol: proto || "http", port, path: pth };
    }

    const hostPortMatch = clean.match(/^[^/:]+:(\d{1,5})(\/.*)?$/);
    if (hostPortMatch) {
      port = hostPortMatch[1];
      pth = hostPortMatch[2] || "/";
      if (!pth.startsWith("/")) pth = "/" + pth;
      return { protocol: proto || "http", port, path: pth };
    }

    return { protocol: proto || "http", port: "", path: clean.startsWith("/") ? clean : "/" + clean };
  }

  function resolveAppLaunchUrl(item) {
    if (!item) return "";
    const currentHost = window.location.hostname;
    const hostWithPort = window.location.host;
    const linkType = detectLinkType(currentHost);
    const rawLan = String(item.fndata_Lan || "").trim();
    const rawWan = String(item.fndata_Wan || "").trim();
    const userProto = Number(item.fndata_Protocol);
    const lanHost = (isLoopbackHost(currentHost) && cachedLanIp) ? cachedLanIp : (cachedLanIp || currentHost);

    const { protocol: lanProtocol, port: targetPort, path: targetPath } = extractPortAndPath(rawLan, userProto);

    switch (linkType) {
      case "FNCONNECT": {
        // 飞牛 ID 远程访问
        if (rawWan) {
          // 有 WAN 配置，WAN 公网直连最高优先级
          return formatTargetUrl(rawWan, currentHost, userProto === 2 ? "https" : "http");
        }
        // 无 WAN 配置：使用飞牛官方二级泛域名远程中继穿透规则
        // 形如 https://<appname>.<fn_id>.5ddd.com<path>
        const appname = item.appname || `fndesk_${item.id}`;
        const subdomain = appname.toLowerCase().replace(/_/g, "-");
        return `https://${subdomain}.${hostWithPort}${targetPath}`;
      }
      case "LAN": {
        // 局域网访问
        const formattedLanHost = (lanHost.includes(":") && !lanHost.startsWith("[")) ? `[${lanHost}]` : lanHost;
        if (targetPort) {
          return `${lanProtocol}://${formattedLanHost}:${targetPort}${targetPath}`;
        }
        return `${lanProtocol}://${formattedLanHost}${targetPath}`;
      }
      case "DOMAIN":
      default: {
        // 自定义公网域名 / DDNS / 反代
        if (rawWan) {
          return formatTargetUrl(rawWan, currentHost, userProto === 2 ? "https" : "http");
        }
        const domProto = userProto === 2 ? "https" : (userProto === 1 ? "http" : (window.location.protocol === "https:" ? "https" : "http"));
        const formattedHost = (currentHost.includes(":") && !currentHost.startsWith("[")) ? `[${currentHost}]` : currentHost;
        if (targetPort) {
          return `${domProto}://${formattedHost}:${targetPort}${targetPath}`;
        }
        return `${domProto}://${formattedHost}${targetPath}`;
      }
    }
  }

  function launchIcon(item) {
    if (!item) return;
    const targetUrl = resolveAppLaunchUrl(item);
    if (!targetUrl) return;

    let iconSrc = item.fndata_LanPic || "";
    if (iconSrc.startsWith("/deskdata")) {
      const stamp = item.updatedAt || Date.now();
      iconSrc = `${PATH_PREFIX}/cgi/ThirdParty/fndesk/index.cgi${iconSrc}?t=${stamp}`;
    }

    if (item.OpenInPage === 1) {
      openIframeWindow(targetUrl, item.fndata_Title, iconSrc);
    } else {
      window.open(targetUrl, "_blank");
    }
  }

  // 1. 捕获阶段拦截桌面 Native App 图标点击，直接打开目标应用，彻底阻断飞牛默认打开 cgi 导致的剥离前缀、白屏和重定向至登录页
  document.addEventListener("click", function(e) {
    const itemEl = e.target.closest("[data-desktop-item-id]");
    if (!itemEl) return;
    const entryKey = itemEl.getAttribute("data-desktop-item-id") || "";
    const match = entryKey.match(/^(fndesk_\d+)\.Application$/);
    if (!match) return;

    const appname = match[1];
    const iconItem = (cachedIcons || []).find(i => i.appname === appname || `fndesk_${i.id}` === appname);
    if (!iconItem) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    launchIcon(iconItem);
  }, true);

  // 2. 双保险：劫持全局 window.open，若有任何调用指向 /cgi/ThirdParty/fndesk_...，自动转为真实应用地址
  if (!window._fndeskOpenPatched) {
    window._fndeskOpenPatched = true;
    const _origOpen = window.open;
    window.open = function(url, target, features) {
      if (typeof url === "string" && url.includes("/cgi/ThirdParty/fndesk_")) {
        const m = url.match(/\/cgi\/ThirdParty\/(fndesk_\d+)\//);
        if (m) {
          const appname = m[1];
          const iconItem = (cachedIcons || []).find(i => i.appname === appname || `fndesk_${i.id}` === appname);
          if (iconItem) {
            const directUrl = resolveAppLaunchUrl(iconItem);
            if (directUrl) {
              return _origOpen.call(window, directUrl, target, features);
            }
          }
        }
        if (PATH_PREFIX && url.startsWith("/cgi/")) {
          url = `${PATH_PREFIX}${url}`;
        }
      }
      return _origOpen.apply(window, arguments);
    };
  }

  // 挂载桌面快捷方式图标到飞牛官方图标列
  function mountShortcutIcons(icons) {
    const desktopContainer = document.querySelector(".box-border.flex.size-full.flex-col.flex-wrap") ||
                             document.querySelector("[data-desktop-item-id]")?.parentElement;
    if (!desktopContainer) return false;

    // 清理旧的注入图标
    desktopContainer.querySelectorAll(".fndesk-custom-shortcut").forEach(e => e.remove());

    const currentHost = window.location.hostname;
    if (isLoopbackHost(currentHost) && !cachedLanIp && lanIpProbeAttempts < 5) {
      lanIpProbeAttempts++;
      ensureLanIp();
      return false;
    }


    icons.forEach(item => {
      if (item.enable === 0) return;

      // 已同步注册为飞牛原生应用 (Native App) 的条目，由飞牛应用中心原生渲染，此处跳过避免重复
      if (item.fnAppicon === 1 || item.nativeInstalled === true) return;

      const finalUrl = resolveAppLaunchUrl(item);
      let iconSrc = item.fndata_LanPic || "";
      if (iconSrc.startsWith("/deskdata")) {
        const stamp = item.updatedAt || Date.now();
        iconSrc = `${PATH_PREFIX}/cgi/ThirdParty/fndesk/index.cgi${iconSrc}?t=${stamp}`;
      }

      const iconNode = document.createElement("div");
      iconNode.className = "box-border flex h-[120px] w-[144px] cursor-pointer select-none flex-col items-center gap-[10px] rounded-xl pt-[22px] fndesk-custom-shortcut";
      iconNode.dataset.fndeskId = item.id;

      iconNode.innerHTML = `
        <div class="inline-flex cursor-pointer flex-col items-center gap-[10px]" role="button" tabindex="0">
          <div class="relative flex size-[52px] shrink-0 flex-row items-center justify-center transition-all duration-150">
            <div class="absolute inset-0 overflow-hidden">
              <div class="box-border size-[80px] p-[15%] !h-[52px] !w-[52px] !p-0">
                <img src="${iconSrc}" alt="${item.fndata_Title}" class="semi-image-img w-full h-full" style="border-radius: 22%; object-fit: contain;" onerror="this.src='${PATH_PREFIX}/cgi/ThirdParty/fndesk/index.cgi/favicon.ico'">
              </div>
            </div>
          </div>
          <div class="flex min-h-base w-fit max-w-[128px] shrink-0 items-start justify-center">
            <div class="line-clamp-2 max-w-[128px] break-words shrink-0 text-center align-top text-[14px] font-bold leading-[18px] text-white" style="text-shadow: rgba(0, 0, 0, 0.4) 0px 1px 6px, rgba(0, 0, 0, 0.6) 0px 0px 4px;">
              ${item.fndata_Title}
            </div>
          </div>
        </div>
      `;

      iconNode.addEventListener("click", () => {
        launchIcon(item);
      });

      desktopContainer.appendChild(iconNode);
    });

    return true;
  }

  // 刷新飞牛原生应用图标缓存：穿透浏览器对 /app-center-static/serviceicon/ 的持久缓存，
  // 确保用户在图标工坊修改裁切或重缩放后，桌面图标能即刻同步更新显示。
  function refreshNativeIcons(icons) {
    if (!icons || !icons.length) return;
    icons.forEach(item => {
      const appname = item.appname || `fndesk_${item.id}`;
      const stamp = item.updatedAt;
      if (!stamp) return;
      const imgs = document.querySelectorAll(`img[src*="/serviceicon/${appname}/"], img[src*="/icon/${appname}/"]`);
      imgs.forEach(img => {
        try {
          const u = new URL(img.src, window.location.href);
          if (u.searchParams.get("_fnt") !== String(stamp)) {
            u.searchParams.set("_fnt", stamp);
            img.src = u.toString();
          }
        } catch (_) {}
      });
    });
  }

  // 主执行循环
  async function init() {
    injectStyles();

    const [iconsRes, statusRes] = await Promise.all([
      apiGet("/icons"),
      apiGet("/status")
    ]);

    if (statusRes && statusRes.lanIp && !isLoopbackHost(statusRes.lanIp)) {
      cachedLanIp = statusRes.lanIp;
    }

    const icons = (iconsRes && iconsRes.icons) ? iconsRes.icons : [];
    cachedIcons = icons;

    // 轮询挂载快捷方式图标与同步原生应用图标缓存
    if (icons.length > 0) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        refreshNativeIcons(cachedIcons);
        if (mountShortcutIcons(cachedIcons) || attempts > 25) {
          if (attempts > 25) clearInterval(timer);
        }
      }, 400);
      setInterval(() => {
        refreshNativeIcons(cachedIcons);
      }, 3000);
    } else {
      // 若首屏请求未拿回图标数据，开启有限重试
      let retryCount = 0;
      const retryTimer = setInterval(async () => {
        retryCount++;
        const res = await apiGet("/icons");
        if (res && res.icons && res.icons.length > 0) {
          clearInterval(retryTimer);
          cachedIcons = res.icons;
          mountShortcutIcons(cachedIcons);
          refreshNativeIcons(cachedIcons);
        } else if (retryCount > 6) {
          clearInterval(retryTimer);
        }
      }, 1500);
    }
  }

  // 延迟启动避免阻碍飞牛 React 首屏
  if (document.readyState === "complete") {
    setTimeout(init, 300);
  } else {
    window.addEventListener("load", () => setTimeout(init, 300));
  }
})();
