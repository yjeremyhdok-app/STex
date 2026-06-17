import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, channelsTable, insertChannelSchema, updateChannelSchema } from "@workspace/db";
import { extractStreams } from "../lib/extract";
import { autoLogin } from "../lib/login";

const router = Router();

router.get("/channels", async (_req, res) => {
  const rows = await db.select().from(channelsTable).orderBy(channelsTable.createdAt);
  res.json(rows);
});

router.post("/channels", async (req, res) => {
  const parsed = insertChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid channel data" });
    return;
  }
  const [row] = await db.insert(channelsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/channels/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = updateChannelSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid channel data" }); return; }
  const [row] = await db.update(channelsTable).set(parsed.data).where(eq(channelsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Channel not found" }); return; }
  res.json(row);
});

router.delete("/channels/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await db.delete(channelsTable).where(eq(channelsTable.id, id)).returning();
  if (result.length === 0) { res.status(404).json({ error: "Channel not found" }); return; }
  res.json({ success: true });
});

router.post("/channels/:id/extract", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [channel] = await db.select().from(channelsTable).where(eq(channelsTable.id, id));
  if (!channel) { res.status(404).json({ error: "Channel not found" }); return; }

  let extraHeaders: Record<string, string> = {};
  try { extraHeaders = JSON.parse(channel.headers || "{}") as Record<string, string>; } catch { extraHeaders = {}; }

  // Auto-login: if loginUrl + credentials are set, login first and inject token into headers
  if (channel.loginUrl && channel.loginUsername && channel.loginPassword) {
    try {
      const loginResult = await autoLogin({
        loginUrl: channel.loginUrl,
        loginBody: channel.loginBody || "{}",
        loginUsername: channel.loginUsername,
        loginPassword: channel.loginPassword,
        tokenPath: channel.tokenPath || "",
        tokenType: channel.tokenType || "bearer",
      });
      // Merge login-derived headers (login headers override manual headers for token fields)
      extraHeaders = { ...extraHeaders, ...loginResult.headers };
    } catch (loginErr) {
      res.status(401).json({
        error: `Đăng nhập thất bại: ${loginErr instanceof Error ? loginErr.message : "Unknown error"}`,
      });
      return;
    }
  }

  const result = await extractStreams(
    channel.url || "",
    extraHeaders,
    channel.apiUrl || "",
    channel.method || "GET",
  );

  res.json({
    links: result.links,
    pageTitle: result.pageTitle || channel.name,
    sourceUrl: channel.apiUrl || channel.url,
    extractedAt: new Date().toISOString(),
    error: result.error,
  });
});

export default router;
