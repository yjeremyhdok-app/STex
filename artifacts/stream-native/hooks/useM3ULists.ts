import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@m3u_store_v2";
const LEGACY_KEY = "@m3u_list_content";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface M3UList {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  sourceUrl?: string;          // HTTP URL or Dropbox path used to originally fetch content
  sourceDropboxPath?: string;  // Dropbox file path (if imported from Dropbox)
  autoRefresh?: boolean;       // Re-fetch from sourceUrl daily
  lastRefreshed?: number;      // Timestamp of last successful refresh
}

export interface M3UHeaders {
  referer: string;
  userAgent: string;
  cookie: string;
  authorization: string;
}

export interface M3UChannel {
  name: string;
  url: string;
  rawUrl: string;
  headers: M3UHeaders;
  extinf: string;
  extinfLine: number;
  urlLine: number;
}

// ── M3U parsing ────────────────────────────────────────────────────────────────

function parseHeaderSuffix(suffix: string): M3UHeaders {
  const h: M3UHeaders = { referer: "", userAgent: "", cookie: "", authorization: "" };
  if (!suffix) return h;
  suffix.split("&").forEach((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    if (key === "referer") h.referer = val;
    else if (key === "user-agent") h.userAgent = val;
    else if (key === "cookie") h.cookie = val;
    else if (key === "authorization") h.authorization = val;
  });
  return h;
}

function parseExtvlcopt(lines: string[], fromLine: number, toLine: number): M3UHeaders {
  const h: M3UHeaders = { referer: "", userAgent: "", cookie: "", authorization: "" };
  for (let i = fromLine; i < toLine; i++) {
    const l = lines[i].trim();
    if (!l.startsWith("#EXTVLCOPT:")) continue;
    const rest = l.slice("#EXTVLCOPT:".length);
    const eq = rest.indexOf("=");
    if (eq < 0) continue;
    const k = rest.slice(0, eq).toLowerCase().trim();
    const v = rest.slice(eq + 1).trim();
    if (k === "http-referrer") h.referer = v;
    else if (k === "http-user-agent") h.userAgent = v;
    else if (k === "http-headers-cookie" || k === "cookie") h.cookie = v;
    else if (k === "http-headers-authorization" || k === "authorization") h.authorization = v;
  }
  return h;
}

export function parseChannels(content: string): M3UChannel[] {
  const lines = content.split("\n");
  const channels: M3UChannel[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF")) continue;

    const lastComma = line.lastIndexOf(",");
    const name = lastComma >= 0 ? line.slice(lastComma + 1).trim() : "Kênh không tên";
    const extinfLine = i;

    let urlLine = -1;
    let rawUrl = "";
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (l && !l.startsWith("#")) { rawUrl = l; urlLine = j; break; }
    }

    if (!rawUrl) continue;

    const pipeIdx = rawUrl.indexOf("|");
    const url = pipeIdx >= 0 ? rawUrl.slice(0, pipeIdx) : rawUrl;
    const suffix = pipeIdx >= 0 ? rawUrl.slice(pipeIdx + 1) : "";

    // Parse headers: prefer #EXTVLCOPT lines; fall back to pipe-suffix for old entries
    const vlcHeaders = parseExtvlcopt(lines, extinfLine + 1, urlLine);
    const hasVlc = !!(vlcHeaders.referer || vlcHeaders.userAgent || vlcHeaders.cookie || vlcHeaders.authorization);
    const headers = hasVlc ? vlcHeaders : parseHeaderSuffix(suffix);

    channels.push({ name, url, rawUrl, headers, extinf: line, extinfLine, urlLine });
    if (urlLine >= 0) i = urlLine;
  }

  return channels;
}

function buildExtinf(oldExtinf: string, newName: string): string {
  const lastComma = oldExtinf.lastIndexOf(",");
  return lastComma >= 0 ? oldExtinf.slice(0, lastComma + 1) + newName : `#EXTINF:-1,${newName}`;
}

export function buildChannelBlock(extinf: string, url: string, headers: M3UHeaders): string {
  const blockLines: string[] = [extinf];
  if (headers.referer) blockLines.push(`#EXTVLCOPT:http-referrer=${headers.referer}`);
  if (headers.userAgent) blockLines.push(`#EXTVLCOPT:http-user-agent=${headers.userAgent}`);
  if (headers.cookie) blockLines.push(`#EXTVLCOPT:http-headers-cookie=${headers.cookie}`);
  if (headers.authorization) blockLines.push(`#EXTVLCOPT:http-headers-authorization=${headers.authorization}`);
  blockLines.push(url);
  return blockLines.join("\n");
}

export function buildHeadersPreview(url: string, headers: M3UHeaders): string {
  const blockLines: string[] = [];
  if (headers.referer) blockLines.push(`#EXTVLCOPT:http-referrer=${headers.referer}`);
  if (headers.userAgent) blockLines.push(`#EXTVLCOPT:http-user-agent=${headers.userAgent}`);
  if (headers.cookie) blockLines.push(`#EXTVLCOPT:http-headers-cookie=${headers.cookie}`);
  if (headers.authorization) blockLines.push(`#EXTVLCOPT:http-headers-authorization=${headers.authorization}`);
  blockLines.push(url);
  return blockLines.join("\n");
}

export function addChannelToContent(content: string, name: string, url: string, headers: M3UHeaders): string {
  const block = buildChannelBlock(`#EXTINF:-1,${name}`, url, headers);
  const base = content.trim();
  if (!base) return `#EXTM3U\n${block}`;
  return `${base}\n${block}`;
}

export function updateChannelInContent(content: string, channel: M3UChannel, name: string, url: string, headers: M3UHeaders): string {
  const lines = content.split("\n");
  const newExtinf = buildExtinf(channel.extinf, name);
  const block = buildChannelBlock(newExtinf, url, headers);
  const blockLines = block.split("\n");
  if (channel.extinfLine >= 0 && channel.urlLine >= channel.extinfLine) {
    lines.splice(channel.extinfLine, channel.urlLine - channel.extinfLine + 1, ...blockLines);
  }
  return lines.join("\n");
}

// ── ID helper ─────────────────────────────────────────────────────────────────

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useM3ULists() {
  const [lists, setLists] = useState<M3UList[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<M3UList[]> => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { lists: M3UList[] };
        const fresh = parsed.lists || [];
        setLists(fresh);
        return fresh;
      } else {
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        if (legacy && legacy.trim()) {
          const migrated: M3UList = {
            id: genId(), name: "Danh sách 1", content: legacy,
            createdAt: Date.now(), updatedAt: Date.now(),
          };
          const next = [migrated];
          setLists(next);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ lists: next }));
          return next;
        }
      }
    } catch { /* ignore */ }
    return [];
  }, []);

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  const persist = useCallback((next: M3UList[]) => {
    setLists(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ lists: next })).catch(() => {});
  }, []);

  const createList = useCallback((name: string, content = "#EXTM3U"): M3UList => {
    const entry: M3UList = { id: genId(), name, content, createdAt: Date.now(), updatedAt: Date.now() };
    persist([...lists, entry]);
    return entry;
  }, [lists, persist]);

  const updateContent = useCallback((id: string, content: string) => {
    persist(lists.map((l) => l.id === id ? { ...l, content, updatedAt: Date.now() } : l));
  }, [lists, persist]);

  const renameList = useCallback((id: string, name: string) => {
    persist(lists.map((l) => l.id === id ? { ...l, name, updatedAt: Date.now() } : l));
  }, [lists, persist]);

  const deleteList = useCallback((id: string) => {
    persist(lists.filter((l) => l.id !== id));
  }, [lists, persist]);

  const addChannel = useCallback((listId: string, name: string, url: string, headers: M3UHeaders) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    const content = addChannelToContent(list.content, name, url, headers);
    persist(lists.map((l) => l.id === listId ? { ...l, content, updatedAt: Date.now() } : l));
  }, [lists, persist]);

  const updateChannel = useCallback((listId: string, channel: M3UChannel, name: string, url: string, headers: M3UHeaders) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    const content = updateChannelInContent(list.content, channel, name, url, headers);
    persist(lists.map((l) => l.id === listId ? { ...l, content, updatedAt: Date.now() } : l));
  }, [lists, persist]);

  const setSource = useCallback((id: string, sourceUrl: string, sourceDropboxPath?: string) => {
    persist(lists.map((l) =>
      l.id === id ? { ...l, sourceUrl, sourceDropboxPath, updatedAt: Date.now() } : l
    ));
  }, [lists, persist]);

  const setAutoRefresh = useCallback((id: string, value: boolean) => {
    persist(lists.map((l) => l.id === id ? { ...l, autoRefresh: value } : l));
  }, [lists, persist]);

  const markRefreshed = useCallback((id: string, content: string) => {
    persist(lists.map((l) =>
      l.id === id ? { ...l, content, updatedAt: Date.now(), lastRefreshed: Date.now() } : l
    ));
  }, [lists, persist]);

  return {
    lists, loading, reload, createList, updateContent, renameList, deleteList,
    addChannel, updateChannel, setSource, setAutoRefresh, markRefreshed,
  };
}
