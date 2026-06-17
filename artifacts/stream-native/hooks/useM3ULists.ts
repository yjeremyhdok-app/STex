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

    channels.push({ name, url, rawUrl, headers: parseHeaderSuffix(suffix), extinf: line, extinfLine, urlLine });
    if (urlLine >= 0) i = urlLine;
  }

  return channels;
}

export function buildUrl(baseUrl: string, headers: M3UHeaders): string {
  const parts: string[] = [];
  if (headers.referer) parts.push(`Referer=${headers.referer}`);
  if (headers.userAgent) parts.push(`User-Agent=${headers.userAgent}`);
  if (headers.cookie) parts.push(`Cookie=${headers.cookie}`);
  if (headers.authorization) parts.push(`Authorization=${headers.authorization}`);
  return parts.length ? `${baseUrl}|${parts.join("&")}` : baseUrl;
}

function buildExtinf(oldExtinf: string, newName: string): string {
  const lastComma = oldExtinf.lastIndexOf(",");
  return lastComma >= 0 ? oldExtinf.slice(0, lastComma + 1) + newName : `#EXTINF:-1,${newName}`;
}

export function addChannelToContent(content: string, name: string, url: string, headers: M3UHeaders): string {
  const block = `#EXTINF:-1,${name}\n${buildUrl(url, headers)}`;
  const base = content.trim();
  if (!base) return `#EXTM3U\n${block}`;
  return `${base}\n${block}`;
}

export function updateChannelInContent(content: string, channel: M3UChannel, name: string, url: string, headers: M3UHeaders): string {
  const lines = content.split("\n");
  if (channel.extinfLine >= 0 && channel.extinfLine < lines.length) {
    lines[channel.extinfLine] = buildExtinf(channel.extinf, name);
  }
  if (channel.urlLine >= 0 && channel.urlLine < lines.length) {
    lines[channel.urlLine] = buildUrl(url, headers);
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

  return { lists, loading, reload, createList, updateContent, renameList, deleteList, addChannel, updateChannel };
}
