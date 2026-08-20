const fs = require("fs");
const path = require("path");

const COVER_DIR = path.join(__dirname, "..", "public", "covers");

function actorToPath(actor) {
  return String(actor || "apify/instagram-scraper").replace("/", "~");
}

function pick(...values) {
  for (const value of values) {
    if (value === 0) return 0;
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeReel(item, requestedUrl) {
  const owner = item.owner || item.ownerUsername || item.username || {};
  const username =
    typeof owner === "string"
      ? owner
      : pick(owner.username, item.ownerUsername, item.username, item.ownerFullName);

  return {
    url: pick(item.url, item.inputUrl, requestedUrl),
    shortcode: pick(item.shortCode, item.shortcode, item.code),
    caption: pick(item.caption, item.text, item.title, ""),
    coverRemote: pick(
      item.displayUrl,
      item.display_url,
      item.thumbnailUrl,
      item.thumbnail,
      item.image,
      item.cover,
      Array.isArray(item.images) ? item.images[0] : null
    ),
    views: Number(pick(item.videoViewCount, item.videoPlayCount, item.playCount, item.plays, item.views, item.video_view_count, 0)) || 0,
    likes: Number(pick(item.likesCount, item.likes, item.likeCount, item.likes_count, 0)) || 0,
    comments: Number(pick(item.commentsCount, item.comments, item.commentCount, 0)) || 0,
    duration: Number(pick(item.videoDuration, item.duration, item.video_duration, 0)) || 0,
    publishedAt: toIso(pick(item.timestamp, item.takenAtTimestamp, item.taken_at, item.date, item.createdAt)),
    ownerUsername: username ? String(username).replace(/^@/, "") : "",
    ownerFullName: pick(item.ownerFullName, owner.fullName, owner.full_name, ""),
  };
}

async function saveCover(remoteUrl, shortcode) {
  if (!remoteUrl || !shortcode) return null;
  fs.mkdirSync(COVER_DIR, { recursive: true });
  try {
    const response = await fetch(remoteUrl, {
      headers: { "User-Agent": "Mozilla/5.0 PifPafCreators/1.0" },
    });
    if (!response.ok) return remoteUrl;
    const buffer = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get("content-type") || "";
    const ext = type.includes("webp") ? "webp" : type.includes("png") ? "png" : "jpg";
    const file = `${shortcode}.${ext}`;
    fs.writeFileSync(path.join(COVER_DIR, file), buffer);
    return `/covers/${file}`;
  } catch {
    return remoteUrl;
  }
}

async function scrapeInstagramUrls(urls) {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    const error = new Error("APIFY_TOKEN не задан");
    error.code = "NO_TOKEN";
    throw error;
  }

  const actor = actorToPath(process.env.APIFY_ACTOR);
  const endpoint = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: urls,
      startUrls: urls.map((url) => ({ url })),
      resultsType: "posts",
      resultsLimit: Math.max(urls.length, 1),
      addParentData: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Apify ответил ${response.status}: ${text.slice(0, 280)}`);
    error.code = "APIFY_HTTP";
    throw error;
  }

  const items = await response.json();
  if (!Array.isArray(items)) {
    const error = new Error("Apify вернул неожиданный формат");
    error.code = "APIFY_SHAPE";
    throw error;
  }

  const byUrl = new Map();
  const normalizedList = [];
  for (const item of items) {
    if (!item || item.error) continue;
    const normalized = normalizeReel(item);
    if (normalized.coverRemote && normalized.shortcode) {
      normalized.cover = await saveCover(normalized.coverRemote, normalized.shortcode);
    } else {
      normalized.cover = normalized.coverRemote;
    }
    normalizedList.push(normalized);
    if (normalized.shortcode) byUrl.set(normalized.shortcode, normalized);
    if (normalized.url) byUrl.set(normalized.url.replace(/\/+$/, ""), normalized);
  }
  return { items: normalizedList, map: byUrl };
}

function configured() {
  return Boolean(process.env.APIFY_TOKEN);
}

module.exports = {
  scrapeInstagramUrls,
  normalizeReel,
  saveCover,
  configured,
  actorToPath,
};
