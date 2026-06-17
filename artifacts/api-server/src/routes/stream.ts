import { Router } from "express";
import { extractStreams } from "../lib/extract";
import { ExtractStreamsBody, GetHistoryResponseItem } from "@workspace/api-zod";

const router = Router();

interface HistoryEntry {
  id: number;
  sourceUrl: string;
  pageTitle: string;
  linkCount: number;
  extractedAt: string;
}

const history: HistoryEntry[] = [];
let historyIdCounter = 1;

router.post("/extract", async (req, res) => {
  const parsed = ExtractStreamsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: url is required" });
    return;
  }

  let targetUrl = parsed.data.url.trim();
  if (!targetUrl.startsWith("http")) targetUrl = `https://${targetUrl}`;

  const result = await extractStreams(targetUrl);

  const entry: HistoryEntry = {
    id: historyIdCounter++,
    sourceUrl: targetUrl,
    pageTitle: result.pageTitle,
    linkCount: result.links.length,
    extractedAt: new Date().toISOString(),
  };
  history.unshift(entry);
  if (history.length > 50) history.pop();

  res.json({
    links: result.links,
    pageTitle: result.pageTitle,
    sourceUrl: targetUrl,
    extractedAt: new Date().toISOString(),
    error: result.error,
  });
});

router.get("/history", (_req, res) => {
  const validated = history.slice(0, 20).map((h) => GetHistoryResponseItem.parse(h));
  res.json(validated);
});

export default router;
