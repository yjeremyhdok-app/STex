import { execFile } from "child_process";
import { promisify } from "util";
import * as cheerio from "cheerio";

const execFileAsync = promisify(execFile);

const YT_DLP_PATH =
  "/nix/store/am2x1y1qyja0hbyjpffj7rcvycp9d644-yt-dlp-2025.6.30/bin/yt-dlp";

export interface StreamLink {
  url: string;
  type: string;
  quality: string | null;
  label: string | null;
}

interface YtDlpFormat {
  url: string;
  ext?: string;
  format_id?: string;
  format_note?: string;
  height?: number | null;
  protocol?: string;
  tbr?: number;
}

interface YtDlpInfo {
  title?: string;
  formats?: YtDlpFormat[];
  url?: string;
  ext?: string;
  format_id?: string;
  protocol?: string;
}

// Extensions that are definitely NOT streams
const NON_STREAM_EXTS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "svg", "ico", "bmp", "avif",
  "woff", "woff2", "ttf", "eot", "otf",
  "js", "css", "html", "htm", "xml", "json",
  "pdf", "zip", "rar", "gz", "tar",
  "php", "aspx", "asp",
]);

// Patterns that indicate a URL is definitely a stream
const STREAM_PATTERNS = [
  { regex: /https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/gi, type: "m3u8" },
  { regex: /https?:\/\/[^\s"'<>\\]+\.mpd(?:\?[^\s"'<>\\]*)?/gi, type: "dash" },
  { regex: /https?:\/\/[^\s"'<>\\]+\.mp4(?:\?[^\s"'<>\\]*)?/gi, type: "mp4" },
  { regex: /https?:\/\/[^\s"'<>\\]+\.webm(?:\?[^\s"'<>\\]*)?/gi, type: "webm" },
  { regex: /https?:\/\/[^\s"'<>\\]+\.flv(?:\?[^\s"'<>\\]*)?/gi, type: "flv" },
  // .ts only when path looks like a segment (contains digits or "segment")
  { regex: /https?:\/\/[^\s"'<>\\]+\/(?:segment|seg|chunk|media|output|live|stream)[^\s"'<>\\]*\.ts(?:\?[^\s"'<>\\]*)?/gi, type: "ts" },
];

// Priority order for sorting: lower index = higher priority
const TYPE_PRIORITY: Record<string, number> = {
  m3u8: 0,
  dash: 1,
  mp4: 2,
  webm: 3,
  ts: 4,
  flv: 5,
  rtmp: 6,
  stream: 99,
};

function sortByType(links: StreamLink[]): StreamLink[] {
  return [...links].sort((a, b) => {
    const pa = TYPE_PRIORITY[a.type] ?? 50;
    const pb = TYPE_PRIORITY[b.type] ?? 50;
    return pa - pb;
  });
}

function isNonStreamUrl(url: string): boolean {
  const path = url.split("?")[0].split("#")[0];
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  return NON_STREAM_EXTS.has(ext);
}

function guessType(fmt: YtDlpFormat): string {
  const url = fmt.url || "";
  const proto = fmt.protocol || "";
  const ext = fmt.ext || "";
  if (url.includes(".m3u8") || proto === "m3u8" || proto === "m3u8_native") return "m3u8";
  if (url.includes(".mpd") || proto === "http_dash_segments") return "dash";
  if (ext === "mp4" || url.includes(".mp4")) return "mp4";
  if (ext === "webm" || url.includes(".webm")) return "webm";
  if (ext === "ts" || url.includes(".ts")) return "ts";
  if (ext === "flv" || url.includes(".flv")) return "flv";
  if (proto.startsWith("rtmp")) return "rtmp";
  return ext || "stream";
}

function guessQuality(fmt: YtDlpFormat): string | null {
  if (fmt.height) return `${fmt.height}p`;
  if (fmt.format_note) return fmt.format_note;
  if (fmt.tbr) return `${Math.round(fmt.tbr)}k`;
  return null;
}

function guessLabel(fmt: YtDlpFormat): string | null {
  const parts: string[] = [];
  if (fmt.format_id) parts.push(fmt.format_id);
  if (fmt.format_note && !fmt.height) parts.push(fmt.format_note);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function findStreamUrls(text: string): StreamLink[] {
  const found = new Map<string, string>();
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  for (const src of [text, decoded]) {
    for (const { regex, type } of STREAM_PATTERNS) {
      for (const m of src.matchAll(regex)) {
        const url = m[0].replace(/['"\\]+$/, "").trim();
        if (url && !found.has(url) && !isNonStreamUrl(url)) found.set(url, type);
      }
    }
  }
  return Array.from(found.entries()).map(([url, type]) => ({
    url,
    type,
    quality: null,
    label: null,
  }));
}

function extractFromHtml(html: string, baseUrl: string): StreamLink[] {
  const $ = cheerio.load(html);
  const found = new Map<string, Omit<StreamLink, "url">>();
  const base = new URL(baseUrl);
  const resolve = (src: string) => {
    try { return src.startsWith("http") ? src : new URL(src, base).href; } catch { return null; }
  };

  $("source").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    const mime = $(el).attr("type") || "";
    const label = $(el).attr("label") || $(el).attr("title") || null;
    if (!src) return;
    const r = resolve(src);
    if (!r || found.has(r) || isNonStreamUrl(r)) return;
    const type = mime.includes("m3u8") ? "m3u8" : mime.includes("mp4") ? "mp4" : mime.includes("webm") ? "webm" : r.split("?")[0].split(".").pop()?.toLowerCase() || "stream";
    found.set(r, { type, quality: null, label });
  });

  $("video[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    const r = resolve(src);
    if (!r || found.has(r) || isNonStreamUrl(r)) return;
    found.set(r, { type: r.split("?")[0].split(".").pop()?.toLowerCase() || "mp4", quality: null, label: null });
  });

  const scripts = $("script").map((_, el) => $(el).html() || "").get().join("\n");
  for (const { url, type, quality, label } of findStreamUrls(html + scripts)) {
    if (!found.has(url)) found.set(url, { type, quality, label });
  }

  return Array.from(found.entries()).map(([url, meta]) => ({ url, ...meta }));
}

// Stream-indicating field names in JSON responses
const STREAM_JSON_FIELDS = new Set([
  "stream", "m3u8", "hls", "manifest", "playback", "src", "source",
  "videourl", "streamurl", "hlsurl", "m3u8url", "mpd", "dashurl",
]);

// Fields that might contain a stream URL but need URL validation
const MAYBE_STREAM_FIELDS = new Set(["url", "link", "uri", "href", "path"]);

function looksLikeStreamUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes(".m3u8") ||
    lower.includes(".mpd") ||
    lower.includes(".flv") ||
    lower.includes(".webm") ||
    lower.includes("hls") ||
    lower.includes("stream") ||
    lower.includes("manifest") ||
    lower.includes("playlist") ||
    lower.includes("live") ||
    lower.includes("output") ||
    lower.includes("bpk") ||
    lower.includes("rtmp") ||
    lower.includes("rtsp")
  );
}

function extractJsonStreamUrls(data: unknown, depth = 0): StreamLink[] {
  if (depth > 8 || data === null || data === undefined) return [];
  const results: StreamLink[] = [];

  if (typeof data === "string") {
    const matches = findStreamUrls(data);
    results.push(...matches);
    return results;
  }

  if (Array.isArray(data)) {
    for (const item of data) results.push(...extractJsonStreamUrls(item, depth + 1));
    return results;
  }

  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      const lk = key.toLowerCase();
      if (typeof value === "string" && value.startsWith("http")) {
        if (isNonStreamUrl(value)) continue;

        if (STREAM_JSON_FIELDS.has(lk) || Array.from(STREAM_JSON_FIELDS).some(f => lk.includes(f))) {
          // Strong stream field — always include
          const ext = value.split("?")[0].split(".").pop()?.toLowerCase() || "";
          const type = value.includes(".m3u8") ? "m3u8" : value.includes(".mpd") ? "dash" : value.includes(".mp4") ? "mp4" : value.includes(".webm") ? "webm" : ext || "stream";
          results.push({ url: value, type, quality: null, label: key });
        } else if (MAYBE_STREAM_FIELDS.has(lk)) {
          // Generic "url"/"link" field — only include if URL looks like a stream
          if (looksLikeStreamUrl(value)) {
            const ext = value.split("?")[0].split(".").pop()?.toLowerCase() || "";
            const type = value.includes(".m3u8") ? "m3u8" : value.includes(".mpd") ? "dash" : value.includes(".mp4") ? "mp4" : value.includes(".webm") ? "webm" : ext || "stream";
            results.push({ url: value, type, quality: null, label: key });
          }
        } else {
          // Other fields — only grab if URL clearly contains stream patterns
          results.push(...findStreamUrls(value));
        }
      } else if (typeof value !== "string") {
        results.push(...extractJsonStreamUrls(value, depth + 1));
      }
    }
  }

  return results;
}

// --- Direct API extraction ---
async function extractFromApi(
  apiUrl: string,
  method: string,
  headers: Record<string, string>,
): Promise<{ links: StreamLink[]; pageTitle: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  const res = await fetch(apiUrl, {
    method: method.toUpperCase(),
    signal: controller.signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      ...headers,
    },
  });
  clearTimeout(timer);

  const text = await res.text();

  let pageTitle = "";
  const links: StreamLink[] = [];

  // Scan raw text for stream URLs (catches m3u8 URLs embedded anywhere)
  const rawFound = findStreamUrls(text);
  links.push(...rawFound);

  // Also try JSON path scanning for known field names
  try {
    const json = JSON.parse(text) as unknown;
    const candidates = extractJsonStreamUrls(json);
    for (const c of candidates) {
      if (!links.find((l) => l.url === c.url)) links.push(c);
    }
    if (typeof json === "object" && json !== null) {
      const obj = json as Record<string, unknown>;
      pageTitle = String(obj.title || obj.name || obj.channel_name || obj.channelName || "");
    }
  } catch {
    // not JSON, raw text scan already done
  }

  return { links, pageTitle };
}

// --- yt-dlp extraction ---
async function extractWithYtDlp(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ links: StreamLink[]; pageTitle: string }> {
  const headerArgs: string[] = [];
  for (const [k, v] of Object.entries(extraHeaders)) {
    headerArgs.push("--add-header", `${k}:${v}`);
  }

  const { stdout } = await execFileAsync(
    YT_DLP_PATH,
    [
      "--dump-json", "--no-playlist", "--no-warnings", "--ignore-errors",
      "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...headerArgs,
      url,
    ],
    { timeout: 30000 },
  );

  const links: StreamLink[] = [];
  let pageTitle = "";

  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    let info: YtDlpInfo;
    try { info = JSON.parse(line) as YtDlpInfo; } catch { continue; }
    if (!pageTitle && info.title) pageTitle = info.title;

    if (info.formats && info.formats.length > 0) {
      const seen = new Set<string>();
      for (const fmt of info.formats) {
        if (!fmt.url || seen.has(fmt.url) || ["mhtml", "storyboard"].includes(fmt.ext || "")) continue;
        if (isNonStreamUrl(fmt.url)) continue;
        seen.add(fmt.url);
        links.push({ url: fmt.url, type: guessType(fmt), quality: guessQuality(fmt), label: guessLabel(fmt) });
      }
    } else if (info.url) {
      if (!isNonStreamUrl(info.url)) {
        links.push({ url: info.url, type: guessType({ url: info.url, ext: info.ext, protocol: info.protocol }), quality: null, label: info.format_id || null });
      }
    }
  }

  return { links, pageTitle };
}

// --- Main export ---
export async function extractStreams(
  targetUrl: string,
  extraHeaders: Record<string, string> = {},
  apiUrl = "",
  method = "GET",
): Promise<{ links: StreamLink[]; pageTitle: string; error: string | null }> {
  let links: StreamLink[] = [];
  let pageTitle = "";
  let errorMsg: string | null = null;

  // 1. If apiUrl provided, call it directly first
  if (apiUrl) {
    try {
      const result = await extractFromApi(apiUrl, method, extraHeaders);
      links = result.links;
      pageTitle = result.pageTitle;
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : "API call failed";
    }
  }

  // 2. If no links yet, try yt-dlp on the page URL
  if (links.length === 0 && targetUrl) {
    try {
      const result = await extractWithYtDlp(targetUrl, extraHeaders);
      links = result.links;
      if (!pageTitle) pageTitle = result.pageTitle;
      errorMsg = null;
    } catch {
      // fall through to HTML scrape
    }
  }

  // 3. Fallback: HTML scrape on the page URL
  if (links.length === 0 && targetUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...extraHeaders,
        },
      });
      clearTimeout(timer);
      const html = await res.text();
      const $ = cheerio.load(html);
      if (!pageTitle) pageTitle = $("title").first().text().trim();
      links = extractFromHtml(html, targetUrl);
    } catch (e) {
      if (!errorMsg) errorMsg = e instanceof Error ? e.message : "Unknown error";
    }
  }

  // Deduplicate then sort: m3u8 first, then dash, mp4, etc.
  const seen = new Set<string>();
  links = links.filter(l => { if (seen.has(l.url)) return false; seen.add(l.url); return true; });
  links = sortByType(links);

  if (links.length === 0 && !errorMsg) errorMsg = "No stream links found";

  return {
    links,
    pageTitle: pageTitle || (targetUrl ? new URL(targetUrl).hostname : (apiUrl ? new URL(apiUrl).hostname : "Unknown")),
    error: errorMsg,
  };
}
