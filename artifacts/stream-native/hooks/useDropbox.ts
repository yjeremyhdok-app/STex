import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "@dropbox_token_v1";
const DROPBOX_API = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT = "https://content.dropboxapi.com/2";

export interface DropboxEntry {
  ".tag": "file" | "folder";
  name: string;
  path_lower: string;
  path_display: string;
  size?: number;
  client_modified?: string;
}

export async function getDropboxToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function saveDropboxToken(token: string): Promise<void> {
  return AsyncStorage.setItem(TOKEN_KEY, token.trim());
}

export async function clearDropboxToken(): Promise<void> {
  return AsyncStorage.removeItem(TOKEN_KEY);
}

export async function dropboxListFolder(token: string, path: string): Promise<DropboxEntry[]> {
  const res = await fetch(`${DROPBOX_API}/files/list_folder`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: path === "/" ? "" : path, recursive: false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error_summary?: string }).error_summary ?? `HTTP ${res.status}`);
  }
  const data = await res.json() as { entries: DropboxEntry[] };
  return data.entries.sort((a, b) => {
    if (a[".tag"] !== b[".tag"]) return a[".tag"] === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function dropboxDownload(token: string, path: string): Promise<string> {
  const res = await fetch(`${DROPBOX_CONTENT}/files/download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });
  if (!res.ok) throw new Error(`Không tải được: HTTP ${res.status}`);
  return res.text();
}

export async function dropboxVerifyToken(token: string): Promise<string> {
  const res = await fetch(`${DROPBOX_API}/users/get_current_account`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Token không hợp lệ");
  const data = await res.json() as { name?: { display_name?: string }; email?: string };
  return data.name?.display_name ?? data.email ?? "Dropbox";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const M3U_EXTS = [".m3u", ".m3u8", ".txt"];
export function isM3UFile(name: string): boolean {
  const lower = name.toLowerCase();
  return M3U_EXTS.some((ext) => lower.endsWith(ext));
}
