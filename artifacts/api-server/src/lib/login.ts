/**
 * Auto-login helper: POST credentials to loginUrl, extract token from response,
 * then return headers to attach to subsequent stream API calls.
 */

function getNestedValue(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function buildLoginBody(
  template: string,
  username: string,
  password: string,
): Record<string, unknown> {
  const filled = template
    .replace(/\{username\}/g, username)
    .replace(/\{password\}/g, password);
  try {
    return JSON.parse(filled) as Record<string, unknown>;
  } catch {
    // fallback: standard username/password body
    return { username, password };
  }
}

export interface LoginResult {
  headers: Record<string, string>;
  token: string;
}

export async function autoLogin(params: {
  loginUrl: string;
  loginBody: string;
  loginUsername: string;
  loginPassword: string;
  tokenPath: string;
  tokenType: string;
}): Promise<LoginResult> {
  const { loginUrl, loginBody, loginUsername, loginPassword, tokenPath, tokenType } = params;

  if (!loginUrl || !loginUsername || !loginPassword) {
    return { headers: {}, token: "" };
  }

  const body = buildLoginBody(loginBody || "{}", loginUsername, loginPassword);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  const res = await fetch(loginUrl, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  clearTimeout(timer);

  if (!res.ok) {
    throw new Error(`Login failed: HTTP ${res.status} from ${loginUrl}`);
  }

  const json = await res.json() as unknown;

  // Find token — try configured path first, then common fallback paths
  const fallbackPaths = [
    tokenPath,
    "data.token", "data.access_token", "data.accessToken",
    "token", "access_token", "accessToken",
    "data.jwt", "jwt",
    "result.token", "result.access_token",
  ].filter(Boolean);

  let token = "";
  for (const p of fallbackPaths) {
    const val = getNestedValue(json, p);
    if (typeof val === "string" && val.length > 0) {
      token = val;
      break;
    }
  }

  if (!token) {
    throw new Error(`Login succeeded but token not found (tried paths: ${fallbackPaths.join(", ")}). Response: ${JSON.stringify(json).slice(0, 300)}`);
  }

  const headers: Record<string, string> = {};
  const type = (tokenType || "bearer").toLowerCase();

  if (type === "bearer") {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (type === "cookie") {
    headers["Cookie"] = token;
  } else if (type === "query") {
    // query param — caller must handle appending to URL; pass as header hint
    headers["X-Token-Query"] = token;
  }

  return { headers, token };
}
