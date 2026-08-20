const state = {
  me: null,
  reels: [],
  stats: null,
  view: "overview",
  sort: "new",
  query: "",
};

const titles = {
  overview: ["Сводка по рилсам", "Обзор"],
  feed: ["Все загруженные видео", "Лента"],
  table: ["Даты, просмотры и синхронизация", "Таблица"],
  analytics: ["Просмотры и вовлечённость", "Аналитика"],
  profile: ["Имя, Instagram и выход", "Кабинет"],
};

function fmt(n) {
  const value = Number(n) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(".0", "")}K`;
  return String(value);
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toast(message) {
  const el = document.querySelector("#toast");
  el.hidden = false;
  el.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 3600);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 401) {
    location.href = "/";
    throw new Error("Нужно войти");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Ошибка запроса");
  return data;
}

function coverSrc(reel) {
  return reel.cover || `https://picsum.photos/seed/${encodeURIComponent(reel.shortcode || reel.id)}/720/900`;
}

function filteredReels() {
  const q = state.query.trim().toLowerCase();
  let list = [...state.reels];
  if (q) {
    list = list.filter((reel) =>
      `${reel.caption} ${reel.ownerUsername} ${reel.shortcode}`.toLowerCase().includes(q)
    );
  }
  if (state.sort === "views") list.sort((a, b) => (b.views || 0) - (a.views || 0));
  return list;
}

function reelCard(reel) {
  return `
    <article class="reel-card">
      <span class="cover-badge ${reel.pending ? "pending-badge" : ""}">${reel.pending ? "ждёт Apify" : fmt(reel.views)}</span>
      <img src="${escapeHtml(coverSrc(reel))}" alt="" />
      <div class="reel-meta">
        <p>${escapeHtml(reel.caption || "Без подписи")}</p>
        <div class="nums">
          <span>${fmtDate(reel.publishedAt)}</span>
          <span>♥ ${fmt(reel.likes)}</span>
          <span>@${escapeHtml(reel.ownerUsername || "instagram")}</span>
        </div>
      </div>
    </article>`;
}

function statCard(label, value, color) {
  return `<article class="stat"><small><span class="dot" style="background:${color}"></span>${label}</small><b>${value}</b></article>`;
}

function renderStats(target, stats) {
  target.innerHTML = [
    statCard("Просмотры", fmt(stats.totalViews), "#6b6fff"),
    statCard("Рилсы", stats.reels, "#ff6b9a"),
    statCard("Средний охват", fmt(stats.avgViews), "#ffb4a2"),
    statCard("Вовлечённость", `${stats.engagement}%`, "#7ad0a8"),
  ].join("");
}

function render() {
  const [kicker, title] = titles[state.view];
  document.querySelector("#kicker").textContent = kicker;
  document.querySelector("#page-title").textContent = title;
  document.querySelectorAll(".nav-btn, .mobile-nav button, .side-user").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.view === state.view);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-on", view.id === `view-${state.view}`);
  });

  document.querySelector("#side-user").innerHTML = `${escapeHtml(state.me.name)}<span>@${escapeHtml(state.me.handle)}</span>`;

  if (state.stats) {
    renderStats(document.querySelector("#stats-row"), state.stats);
    renderStats(document.querySelector("#analytics-stats"), state.stats);
  }

  const latest = [...state.reels].slice(0, 4);
  document.querySelector("#overview-feed").innerHTML = latest.map(reelCard).join("");

  const list = filteredReels();
  document.querySelector("#feed-grid").innerHTML = list.map(reelCard).join("");
  document.querySelector("#feed-empty").classList.toggle("hidden", list.length > 0);

  document.querySelector("#table-body").innerHTML = list
    .map(
      (reel) => `
      <tr>
        <td>
          <div class="cell-reel">
            <img src="${escapeHtml(coverSrc(reel))}" alt="" />
            <div>
              <div>${escapeHtml((reel.caption || "Без подписи").slice(0, 48))}</div>
              <a href="${escapeHtml(reel.url)}" target="_blank" rel="noreferrer">открыть в Instagram</a>
            </div>
          </div>
        </td>
        <td>${fmtDate(reel.publishedAt)}</td>
        <td>${fmt(reel.views)}</td>
        <td>${fmt(reel.likes)}</td>
        <td>${fmt(reel.comments)}</td>
        <td>${reel.pending ? "ожидает" : fmtDate(reel.lastSyncedAt)}</td>
        <td>
          <button class="icon-btn" data-refresh="${reel.id}" type="button">↻</button>
          <button class="icon-btn" data-del="${reel.id}" type="button">✕</button>
        </td>
      </tr>`
    )
    .join("");

  const best = state.stats?.best;
  document.querySelector("#best-card").innerHTML = best
    ? `<h3>Лучший рилс</h3><img src="${escapeHtml(coverSrc(best))}" alt="" /><p>${escapeHtml(best.caption || "")}</p><b>${fmt(best.views)} просмотров</b>`
    : `<h3>Лучший рилс</h3><p class="lede sm">Добавь видео — здесь появится лидер.</p>`;

  drawChart(state.stats?.series || []);
  if (state.view === "analytics") {
    requestAnimationFrame(() => drawChart(state.stats?.series || []));
  }

  const form = document.querySelector("#profile-form");
  form.name.value = state.me.name;
  form.handle.value = state.me.handle || "";
  document.querySelector("#profile-email").textContent = state.me.email;
}

function drawChart(series) {
  const canvas = document.querySelector("#views-chart");
  const wrap = canvas.parentElement;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(wrap.clientWidth || 0));
  const height = 220;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!width) return;
  if (!series.length) {
    ctx.fillStyle = "#8b86a3";
    ctx.font = "500 13px Inter, sans-serif";
    ctx.fillText("После синхронизации здесь появится график", 16, 40);
    return;
  }
  const max = Math.max(...series.map((item) => item.views), 1);
  const pad = 28;
  const step = (width - pad * 2) / Math.max(series.length - 1, 1);
  ctx.beginPath();
  series.forEach((item, index) => {
    const x = pad + index * step;
    const y = height - pad - (item.views / max) * (height - pad * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#6b6fff";
  ctx.lineWidth = 3;
  ctx.stroke();
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(107,111,255,0.22)");
  gradient.addColorStop(1, "rgba(107,111,255,0)");
  ctx.lineTo(pad + (series.length - 1) * step, height - pad);
  ctx.lineTo(pad, height - pad);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}

function setView(view) {
  state.view = view;
  render();
}

async function loadAll() {
  const [me, reels, stats] = await Promise.all([
    api("/api/me"),
    api("/api/reels"),
    api("/api/stats"),
  ]);
  state.me = me.user;
  state.reels = reels.reels;
  state.stats = stats;
  render();
}

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

document.querySelector("#feed-search").addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

document.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.sort = btn.dataset.sort;
    document.querySelectorAll(".seg-btn").forEach((item) => item.classList.toggle("is-on", item === btn));
    render();
  });
});

const modal = document.querySelector("#modal");
document.querySelector("#add-open").addEventListener("click", () => modal.classList.remove("hidden"));
document.querySelector("#add-cancel").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (event) => {
  if (event.target === modal) modal.classList.add("hidden");
});

document.querySelector("#add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const data = await api("/api/reels", {
      method: "POST",
      body: JSON.stringify({ url: event.target.url.value }),
    });
    if (data.warning) toast(data.warning);
    else toast("Рилс подтянут");
    event.target.reset();
    modal.classList.add("hidden");
    await loadAll();
    setView("feed");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#refresh-all").addEventListener("click", async (event) => {
  event.target.disabled = true;
  try {
    await api("/api/reels/refresh-all", { method: "POST", body: "{}" });
    toast("Цифры обновлены из Instagram");
    await loadAll();
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.disabled = false;
  }
});

document.querySelector("#table-body").addEventListener("click", async (event) => {
  const refreshId = event.target.dataset.refresh;
  const delId = event.target.dataset.del;
  try {
    if (refreshId) {
      await api(`/api/reels/${refreshId}/refresh`, { method: "POST", body: "{}" });
      toast("Обновили этот рилс");
      await loadAll();
    }
    if (delId) {
      await api(`/api/reels/${delId}`, { method: "DELETE" });
      await loadAll();
    }
  } catch (error) {
    toast(error.message);
  }
});

document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/me", {
      method: "PATCH",
      body: JSON.stringify({
        name: event.target.name.value,
        handle: event.target.handle.value,
      }),
    });
    state.me = data.user;
    toast("Кабинет сохранён");
    render();
  } catch (error) {
    toast(error.message);
  }
});

document.querySelector("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  location.href = "/";
});

async function loadStatus() {
  const status = await api("/api/status");
  document.querySelector("#apify-box").innerHTML = status.apify
    ? `Apify подключён · актор <b>${escapeHtml(status.actor)}</b>. Бесплатного кредита хватает на сотни одиночных рилсов.`
    : `Чтобы подтягивать просмотры и обложки, положи токен в <b>.env</b> как <b>APIFY_TOKEN</b> (актор ${escapeHtml(status.actor)}). Пока рилсы сохраняются по ссылке.`;
}

loadAll().then(loadStatus).catch((error) => {
  toast(error.message);
});

window.addEventListener("resize", () => {
  if (state.view === "analytics") drawChart(state.stats?.series || []);
});
