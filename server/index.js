const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const express = require("express");
const cookieParser = require("cookie-parser");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const store = require("./store");
const apify = require("./apify");

const app = express();
const PORT = Number(process.env.PORT) || 3847;
const SECRET = process.env.SESSION_SECRET || "pifpaf-creators-dev-secret";
const COOKIE = "pifpaf_sid";

const INSTAGRAM_RE =
  /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i;

function parseInstagramUrl(raw) {
  const url = String(raw || "").trim();
  const match = url.match(INSTAGRAM_RE);
  if (!match) return null;
  const shortcode = match[3];
  return {
    url: `https://www.instagram.com/reel/${shortcode}/`,
    shortcode,
  };
}

function sign(userId) {
  const hmac = crypto.createHmac("sha256", SECRET).update(userId).digest("hex");
  return `${userId}.${hmac}`;
}

function unsign(value) {
  if (!value || !value.includes(".")) return null;
  const userId = value.slice(0, value.lastIndexOf("."));
  const mac = value.slice(value.lastIndexOf(".") + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(userId).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return userId;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    handle: user.handle,
    createdAt: user.createdAt,
  };
}

function publicReel(reel) {
  const history = reel.history || [];
  return {
    id: reel.id,
    url: reel.url,
    shortcode: reel.shortcode,
    cover: reel.cover,
    caption: reel.caption || "",
    views: reel.views || 0,
    likes: reel.likes || 0,
    comments: reel.comments || 0,
    duration: reel.duration || 0,
    publishedAt: reel.publishedAt,
    ownerUsername: reel.ownerUsername || "",
    lastSyncedAt: reel.lastSyncedAt,
    pending: Boolean(reel.pending),
    createdAt: reel.createdAt,
    history: history.slice(-14),
  };
}

function setSession(res, userId) {
  res.cookie(COOKIE, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

function auth(req, res, next) {
  const userId = unsign(req.cookies[COOKIE]);
  const db = store.readStore();
  const user = db.users.find((item) => item.id === userId);
  if (!user) return res.status(401).json({ error: "Нужно войти в кабинет" });
  req.user = user;
  next();
}

function computeStats(reels) {
  const totalViews = reels.reduce((sum, reel) => sum + (reel.views || 0), 0);
  const totalLikes = reels.reduce((sum, reel) => sum + (reel.likes || 0), 0);
  const totalComments = reels.reduce((sum, reel) => sum + (reel.comments || 0), 0);
  const best = [...reels].sort((a, b) => (b.views || 0) - (a.views || 0))[0] || null;
  const engagement =
    totalViews > 0 ? ((totalLikes + totalComments) / totalViews) * 100 : 0;

  const byDay = new Map();
  for (const reel of reels) {
    for (const point of reel.history || []) {
      const day = String(point.at || "").slice(0, 10);
      if (!day) continue;
      byDay.set(day, (byDay.get(day) || 0) + (point.views || 0));
    }
    if (!(reel.history || []).length && reel.publishedAt) {
      const day = reel.publishedAt.slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + (reel.views || 0));
    }
  }

  const series = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([day, views]) => ({ day, views }));

  return {
    reels: reels.length,
    totalViews,
    totalLikes,
    totalComments,
    avgViews: reels.length ? Math.round(totalViews / reels.length) : 0,
    engagement: Number(engagement.toFixed(2)),
    best: best ? publicReel(best) : null,
    series,
    pending: reels.filter((reel) => reel.pending).length,
  };
}

function pushHistory(reel, views) {
  const history = Array.isArray(reel.history) ? reel.history : [];
  const today = new Date().toISOString().slice(0, 10);
  const last = history[history.length - 1];
  if (last && String(last.at).slice(0, 10) === today) {
    last.views = views;
    last.at = new Date().toISOString();
  } else {
    history.push({ at: new Date().toISOString(), views });
  }
  reel.history = history.slice(-30);
}

async function applyScraped(reel, scraped) {
  if (!scraped) return reel;
  reel.caption = scraped.caption || reel.caption;
  reel.views = scraped.views ?? reel.views;
  reel.likes = scraped.likes ?? reel.likes;
  reel.comments = scraped.comments ?? reel.comments;
  reel.duration = scraped.duration || reel.duration;
  reel.publishedAt = scraped.publishedAt || reel.publishedAt;
  reel.ownerUsername = scraped.ownerUsername || reel.ownerUsername;
  reel.cover = scraped.cover || scraped.coverRemote || reel.cover;
  reel.pending = false;
  reel.lastSyncedAt = new Date().toISOString();
  pushHistory(reel, reel.views || 0);
  return reel;
}

function seedDemo() {
  store.update((db) => {
    if (db.users.some((user) => user.email === "demo@pifpafai.com")) return;
    const userId = "demo-viki";
    db.users.push({
      id: userId,
      email: "demo@pifpafai.com",
      passwordHash: bcrypt.hashSync("pifpaf", 10),
      name: "Вика",
      handle: "viki.trends",
      createdAt: "2026-06-12T10:00:00.000Z",
    });

    const covers = [
      "/covers/demo1.jpg",
      "/covers/demo2.jpg",
      "/covers/demo3.jpg",
      "/covers/demo4.jpg",
      "/covers/demo5.jpg",
      "/covers/demo6.jpg",
    ];
    const captions = [
      "PifPaf за 10 секунд — тот самый тренд из Reels ✨",
      "До / после: аватарка без промптов",
      "Парная фотка с подругой, шаблон из ленты",
      "Pinterest-повтор по референсу — повторили в один клик",
      "Утренний ритуал: новые кадры к сторис",
      "Как я снимаю обложки для PifPaf",
    ];
    const views = [182340, 96420, 241900, 51200, 128800, 73410];
    const likes = [8420, 5102, 12110, 2304, 6880, 4011];
    const comments = [312, 188, 540, 76, 221, 143];
    const daysAgo = [2, 5, 8, 12, 16, 21];

    covers.forEach((cover, index) => {
      const published = new Date(Date.now() - daysAgo[index] * 86400000);
      const shortcode = `demo${index + 1}pifpaf`;
      const history = [3, 2, 1, 0].map((offset) => {
        const at = new Date(published.getTime() + (3 - offset) * 86400000);
        const growth = 1 - offset * 0.12;
        return { at: at.toISOString(), views: Math.round(views[index] * growth) };
      });
      db.reels.push({
        id: `demo-reel-${index + 1}`,
        userId,
        url: `https://www.instagram.com/reel/${shortcode}/`,
        shortcode,
        cover,
        caption: captions[index],
        views: views[index],
        likes: likes[index],
        comments: comments[index],
        duration: [12, 8, 15, 9, 11, 14][index],
        publishedAt: published.toISOString(),
        ownerUsername: "viki.trends",
        lastSyncedAt: new Date().toISOString(),
        pending: false,
        createdAt: published.toISOString(),
        history,
      });
    });
  });
}

seedDemo();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/status", (_req, res) => {
  res.json({
    apify: apify.configured(),
    actor: process.env.APIFY_ACTOR || "apify/instagram-scraper",
  });
});

app.post("/api/auth/register", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim();
  const handle = String(req.body.handle || "").trim().replace(/^@/, "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Введи нормальный email" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Пароль — минимум 6 символов" });
  }
  if (!name) return res.status(400).json({ error: "Как тебя зовут?" });

  try {
    const user = store.update((db) => {
      if (db.users.some((item) => item.email === email)) {
        const error = new Error("Такой email уже есть");
        error.code = "TAKEN";
        throw error;
      }
      const created = {
        id: crypto.randomUUID(),
        email,
        passwordHash: bcrypt.hashSync(password, 10),
        name,
        handle: handle || email.split("@")[0],
        createdAt: new Date().toISOString(),
      };
      db.users.push(created);
      return created;
    });
    setSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (error) {
    if (error.code === "TAKEN") return res.status(409).json({ error: error.message });
    throw error;
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const db = store.readStore();
  const user = db.users.find((item) => item.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Неверный email или пароль" });
  }
  setSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch("/api/me", auth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const handle = String(req.body.handle || "").trim().replace(/^@/, "");
  const user = store.update((db) => {
    const current = db.users.find((item) => item.id === req.user.id);
    if (name) current.name = name;
    if (handle) current.handle = handle;
    return current;
  });
  res.json({ user: publicUser(user) });
});

app.get("/api/reels", auth, (req, res) => {
  const db = store.readStore();
  const reels = db.reels
    .filter((reel) => reel.userId === req.user.id)
    .sort((a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt)))
    .map(publicReel);
  res.json({ reels });
});

app.get("/api/stats", auth, (req, res) => {
  const db = store.readStore();
  const reels = db.reels.filter((reel) => reel.userId === req.user.id);
  res.json(computeStats(reels));
});

app.post("/api/reels", auth, async (req, res) => {
  const parsed = parseInstagramUrl(req.body.url);
  if (!parsed) {
    return res.status(400).json({ error: "Нужна ссылка на Instagram Reel или пост" });
  }

  const db = store.readStore();
  if (db.reels.some((reel) => reel.userId === req.user.id && reel.shortcode === parsed.shortcode)) {
    return res.status(409).json({ error: "Этот рилс уже есть в кабинете" });
  }

  const reel = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    url: parsed.url,
    shortcode: parsed.shortcode,
    cover: "",
    caption: "",
    views: 0,
    likes: 0,
    comments: 0,
    duration: 0,
    publishedAt: new Date().toISOString(),
    ownerUsername: req.user.handle || "",
    lastSyncedAt: null,
    pending: true,
    createdAt: new Date().toISOString(),
    history: [],
  };

  let warning = null;
  if (apify.configured()) {
    try {
      const scraped = await apify.scrapeInstagramUrls([parsed.url]);
      const match =
        scraped.map.get(parsed.shortcode) ||
        scraped.map.get(parsed.url.replace(/\/+$/, "")) ||
        scraped.items[0];
      await applyScraped(reel, match);
    } catch (error) {
      warning = error.message;
    }
  } else {
    warning = "Apify-токен не задан — рилс сохранён, цифры подтянутся после .env";
  }

  store.update((current) => {
    current.reels.push(reel);
  });

  res.status(201).json({ reel: publicReel(reel), warning });
});

app.post("/api/reels/refresh-all", auth, async (req, res) => {
  const db = store.readStore();
  const mine = db.reels.filter((reel) => reel.userId === req.user.id);
  if (!mine.length) return res.json({ reels: [], warning: null });
  if (!apify.configured()) {
    return res.status(400).json({ error: "Добавь APIFY_TOKEN в .env, чтобы обновлять просмотры" });
  }

  try {
    const scraped = await apify.scrapeInstagramUrls(mine.map((reel) => reel.url));
    const updated = store.update((current) => {
      for (const reel of current.reels) {
        if (reel.userId !== req.user.id) continue;
        const match =
          scraped.map.get(reel.shortcode) ||
          scraped.map.get(reel.url.replace(/\/+$/, "")) ||
          scraped.items.find((item) => item.shortcode === reel.shortcode);
        applyScraped(reel, match);
      }
      return current.reels.filter((reel) => reel.userId === req.user.id).map(publicReel);
    });
    res.json({ reels: updated, warning: null });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post("/api/reels/:id/refresh", auth, async (req, res) => {
  const db = store.readStore();
  const reel = db.reels.find((item) => item.id === req.params.id && item.userId === req.user.id);
  if (!reel) return res.status(404).json({ error: "Рилс не найден" });
  if (!apify.configured()) {
    return res.status(400).json({ error: "Добавь APIFY_TOKEN в .env, чтобы обновлять просмотры" });
  }

  try {
    const scraped = await apify.scrapeInstagramUrls([reel.url]);
    const match =
      scraped.map.get(reel.shortcode) ||
      scraped.map.get(reel.url.replace(/\/+$/, "")) ||
      scraped.items[0];
    const updated = store.update((current) => {
      const target = current.reels.find((item) => item.id === reel.id);
      applyScraped(target, match);
      return target;
    });
    res.json({ reel: publicReel(updated) });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.delete("/api/reels/:id", auth, (req, res) => {
  store.update((db) => {
    db.reels = db.reels.filter((reel) => !(reel.id === req.params.id && reel.userId === req.user.id));
  });
  res.json({ ok: true });
});

app.get("/app", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "app.html"));
});

app.listen(PORT, () => {
  console.log(`PifPaf Creators → http://localhost:${PORT}`);
});
