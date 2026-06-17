import React, { useState, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { VideoView, useVideoPlayer, VideoSource } from "expo-video";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";

// ── Types ──────────────────────────────────────────────────────────────────────

type DrmMode = "none" | "clearkey" | "widevine";
type KeyFormat = "hex" | "raw";

/** Single combined "keyId:key" entry */
interface KeyEntry {
  combined: string;
}

interface WvHeader {
  name: string;
  value: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DRM_LABELS: Record<DrmMode, string> = {
  none: "Không DRM",
  clearkey: "ClearKey",
  widevine: "Widevine",
};

const DRM_COLORS: Record<DrmMode, string> = {
  none: "#6b7280",
  clearkey: "#22c55e",
  widevine: "#3b82f6",
};

// ── Conversion helpers ────────────────────────────────────────────────────────

/** base64url string → lowercase hex string */
function base64urlToHex(b64url: string): string {
  try {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const rem = b64.length % 4;
    const padded = rem ? b64 + "=".repeat(4 - rem) : b64;
    const binary: string = atob(padded);
    return Array.from(binary, (c) =>
      c.charCodeAt(0).toString(16).padStart(2, "0")
    ).join("");
  } catch {
    return b64url; // fallback: pass through as-is
  }
}

/**
 * Parse a "keyId:key" combined string.
 * Returns [keyIdHex, keyHex] — converting from base64url if format === "raw".
 */
function parseKeyEntry(
  combined: string,
  format: KeyFormat
): [string, string] | null {
  const idx = combined.indexOf(":");
  if (idx === -1) return null;
  const left = combined.slice(0, idx).trim();
  const right = combined.slice(idx + 1).trim();
  if (!left || !right) return null;

  if (format === "raw") {
    return [base64urlToHex(left), base64urlToHex(right)];
  }
  return [left, right];
}

function buildSource(
  url: string,
  drm: DrmMode,
  keyEntries: KeyEntry[],
  keyFormat: KeyFormat,
  wvUrl: string,
  wvHeaders: WvHeader[]
): VideoSource | null {
  if (!url.trim()) return null;

  if (drm === "none") {
    return { uri: url.trim() };
  }

  if (drm === "clearkey") {
    const clearKeys: Record<string, string> = {};
    keyEntries.forEach(({ combined }) => {
      const parsed = parseKeyEntry(combined, keyFormat);
      if (parsed) clearKeys[parsed[0]] = parsed[1];
    });
    return {
      uri: url.trim(),
      drm: {
        type: "clearkey" as const,
        clearKeys: Object.keys(clearKeys).length ? clearKeys : undefined,
      },
    } as VideoSource;
  }

  if (drm === "widevine") {
    const headers: Record<string, string> = {};
    wvHeaders.forEach((h) => {
      if (h.name.trim() && h.value.trim()) headers[h.name.trim()] = h.value.trim();
    });
    return {
      uri: url.trim(),
      drm: {
        type: "widevine" as const,
        licenseServer: wvUrl.trim() || undefined,
        headers: Object.keys(headers).length ? headers : undefined,
      },
    } as VideoSource;
  }

  return { uri: url.trim() };
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function TestScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [url, setUrl] = useState("");
  const [drmMode, setDrmMode] = useState<DrmMode>("none");

  // ClearKey state
  const [keyFormat, setKeyFormat] = useState<KeyFormat>("hex");
  const [keyEntries, setKeyEntries] = useState<KeyEntry[]>([{ combined: "" }]);

  // Widevine state
  const [wvLicense, setWvLicense] = useState("");
  const [wvHeaders, setWvHeaders] = useState<WvHeader[]>([{ name: "", value: "" }]);

  // Player state
  const [activeSource, setActiveSource] = useState<VideoSource | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const videoRef = useRef<VideoView>(null);

  const player = useVideoPlayer(
    activeSource,
    useCallback((p) => { p.play(); }, [])
  );

  const status = player.status;
  const isBuffering = status === "loading";
  const isPlaying = status === "readyToPlay" && player.playing;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleTest = () => {
    const source = buildSource(url, drmMode, keyEntries, keyFormat, wvLicense, wvHeaders);
    if (!source) {
      Alert.alert("Thiếu URL", "Nhập URL stream M3U8 trước");
      return;
    }
    setActiveSource(source);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleClear = () => {
    setActiveSource(null);
    setUrl("");
    setDrmMode("none");
    setKeyFormat("hex");
    setKeyEntries([{ combined: "" }]);
    setWvLicense("");
    setWvHeaders([{ name: "", value: "" }]);
  };

  // Key entry helpers
  const addKeyEntry = () => setKeyEntries((p) => [...p, { combined: "" }]);
  const removeKeyEntry = (i: number) =>
    setKeyEntries((p) => p.filter((_, idx) => idx !== i));
  const updateKeyEntry = (i: number, val: string) =>
    setKeyEntries((p) => p.map((e, idx) => (idx === i ? { combined: val } : e)));

  // Widevine header helpers
  const addWvHeader = () => setWvHeaders((p) => [...p, { name: "", value: "" }]);
  const removeWvHeader = (i: number) =>
    setWvHeaders((p) => p.filter((_, idx) => idx !== i));
  const updateWvHeader = (i: number, field: "name" | "value", val: string) =>
    setWvHeaders((p) =>
      p.map((h, idx) => (idx === i ? { ...h, [field]: val } : h))
    );

  const screenH = Dimensions.get("window").height;

  // Placeholder based on selected format
  const keyPlaceholder =
    keyFormat === "hex"
      ? "keyId_hex:key_hex"
      : "base64url_keyId:base64url_key";

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Test Player</Text>
        {activeSource && (
          <TouchableOpacity
            style={[s.clearBtn, { borderColor: colors.border }]}
            onPress={handleClear}
          >
            <Feather name="x" size={14} color={colors.mutedForeground} />
            <Text style={[s.clearTxt, { color: colors.mutedForeground }]}>Xoá</Text>
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* URL input */}
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.cardHeader}>
              <Feather name="play-circle" size={14} color={colors.primary} />
              <Text style={[s.cardTitle, { color: colors.foreground }]}>URL Stream</Text>
            </View>
            <TextInput
              style={[s.monoInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="https://example.com/stream/index.m3u8"
              placeholderTextColor={colors.mutedForeground}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
            />
          </View>

          {/* DRM section */}
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.cardHeader}>
              <Feather name="shield" size={14} color={colors.primary} />
              <Text style={[s.cardTitle, { color: colors.foreground }]}>Loại DRM</Text>
            </View>

            {/* DRM mode pills */}
            <View style={s.pillRow}>
              {(["none", "clearkey", "widevine"] as DrmMode[]).map((mode) => {
                const active = drmMode === mode;
                const accent = DRM_COLORS[mode];
                const icon =
                  mode === "widevine" ? "lock"
                  : mode === "clearkey" ? "key"
                  : "unlock";
                return (
                  <TouchableOpacity
                    key={mode}
                    style={[
                      s.pill,
                      {
                        backgroundColor: active ? accent + "20" : colors.background,
                        borderColor: active ? accent : colors.border,
                      },
                    ]}
                    onPress={() => setDrmMode(mode)}
                  >
                    <Feather
                      name={icon}
                      size={11}
                      color={active ? accent : colors.mutedForeground}
                    />
                    <Text style={[s.pillTxt, { color: active ? accent : colors.mutedForeground }]}>
                      {DRM_LABELS[mode]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── ClearKey fields ─────────────────────────────────── */}
            {drmMode === "clearkey" && (
              <View style={{ marginTop: 16, gap: 12 }}>
                {/* Format selector */}
                <View style={s.formatRow}>
                  <Text style={[s.fieldLabel, { color: colors.mutedForeground, flex: 1 }]}>
                    Định dạng key
                  </Text>
                  <View style={s.pillRow}>
                    {(["hex", "raw"] as KeyFormat[]).map((fmt) => {
                      const active = keyFormat === fmt;
                      return (
                        <TouchableOpacity
                          key={fmt}
                          style={[
                            s.fmtPill,
                            {
                              backgroundColor: active
                                ? colors.primary + "18"
                                : colors.background,
                              borderColor: active ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={() => setKeyFormat(fmt)}
                        >
                          <Text
                            style={[
                              s.fmtPillTxt,
                              { color: active ? colors.primary : colors.mutedForeground },
                            ]}
                          >
                            {fmt === "hex" ? "Hex" : "Base64url (raw)"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Helper note about format */}
                <View style={[s.noteBanner, { backgroundColor: "#22c55e12", borderColor: "#22c55e30" }]}>
                  <Feather name="info" size={12} color="#22c55e" />
                  <Text style={[s.noteTxt, { color: "#22c55e" }]}>
                    {keyFormat === "hex"
                      ? "Nhập dạng keyId:key — cả hai là chuỗi hex (đã chuyển đổi)"
                      : "Nhập dạng keyId:key — cả hai là base64url (raw), app sẽ tự chuyển sang hex"}
                  </Text>
                </View>

                {/* Key entries — ONE combined field each */}
                <View style={{ gap: 8 }}>
                  <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>
                    Key — có thể thêm nhiều
                  </Text>
                  {keyEntries.map((entry, i) => (
                    <View key={i} style={s.keyEntryRow}>
                      <TextInput
                        style={[
                          s.monoInput,
                          {
                            flex: 1,
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                            color: colors.foreground,
                          },
                        ]}
                        placeholder={keyPlaceholder}
                        placeholderTextColor={colors.mutedForeground}
                        value={entry.combined}
                        onChangeText={(v) => updateKeyEntry(i, v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {keyEntries.length > 1 && (
                        <TouchableOpacity
                          style={s.removeBtn}
                          onPress={() => removeKeyEntry(i)}
                        >
                          <Feather name="minus-circle" size={20} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity
                    style={[s.addBtn, { borderColor: colors.border }]}
                    onPress={addKeyEntry}
                  >
                    <Feather name="plus" size={14} color={colors.primary} />
                    <Text style={[s.addBtnTxt, { color: colors.primary }]}>Thêm key</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Widevine fields ─────────────────────────────────── */}
            {drmMode === "widevine" && (
              <View style={{ marginTop: 16, gap: 12 }}>
                <View style={{ gap: 6 }}>
                  <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>
                    License Server URL
                  </Text>
                  <TextInput
                    style={[s.monoInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    placeholder="https://license.example.com/widevine"
                    placeholderTextColor={colors.mutedForeground}
                    value={wvLicense}
                    onChangeText={setWvLicense}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>
                    Headers tùy chỉnh (tuỳ chọn)
                  </Text>
                  {wvHeaders.map((h, i) => (
                    <View key={i} style={[s.keyEntryRow, { alignItems: "center" }]}>
                      <TextInput
                        style={[s.monoInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                        placeholder="Tên header"
                        placeholderTextColor={colors.mutedForeground}
                        value={h.name}
                        onChangeText={(v) => updateWvHeader(i, "name", v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Text style={{ color: colors.mutedForeground, marginHorizontal: 4 }}>:</Text>
                      <TextInput
                        style={[s.monoInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                        placeholder="Giá trị"
                        placeholderTextColor={colors.mutedForeground}
                        value={h.value}
                        onChangeText={(v) => updateWvHeader(i, "value", v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {wvHeaders.length > 1 && (
                        <TouchableOpacity
                          style={{ marginLeft: 6 }}
                          onPress={() => removeWvHeader(i)}
                        >
                          <Feather name="minus-circle" size={20} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity
                    style={[s.addBtn, { borderColor: colors.border }]}
                    onPress={addWvHeader}
                  >
                    <Feather name="plus" size={14} color={colors.primary} />
                    <Text style={[s.addBtnTxt, { color: colors.primary }]}>Thêm header</Text>
                  </TouchableOpacity>
                </View>

                <View style={[s.noteBanner, { backgroundColor: "#3b82f612", borderColor: "#3b82f630" }]}>
                  <Feather name="info" size={12} color="#3b82f6" />
                  <Text style={[s.noteTxt, { color: "#3b82f6" }]}>
                    Widevine chỉ hoạt động trên Android. iOS dùng FairPlay.{"\n"}
                    Cần development build — không hoạt động trong Expo Go.
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Test button */}
          <TouchableOpacity
            style={[s.testBtn, { backgroundColor: colors.primary }]}
            onPress={handleTest}
            activeOpacity={0.8}
          >
            <Feather name="play" size={18} color={colors.primaryForeground} />
            <Text style={[s.testBtnTxt, { color: colors.primaryForeground }]}>
              Test stream
            </Text>
          </TouchableOpacity>

          {/* Video player */}
          {activeSource && (
            <View
              style={[s.playerCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              {/* Status bar */}
              <View style={s.playerHeaderRow}>
                <View style={s.statusRow}>
                  <View
                    style={[
                      s.dot,
                      {
                        backgroundColor: isBuffering
                          ? "#f59e0b"
                          : isPlaying
                          ? "#22c55e"
                          : "#ef4444",
                      },
                    ]}
                  />
                  <Text style={[s.statusTxt, { color: colors.mutedForeground }]}>
                    {isBuffering ? "Đang tải..." : isPlaying ? "Đang phát" : "Chờ..."}
                  </Text>
                </View>
                <View style={s.drmBadge}>
                  <Feather
                    name={drmMode === "none" ? "unlock" : "lock"}
                    size={10}
                    color={DRM_COLORS[drmMode]}
                  />
                  <Text style={[s.drmBadgeTxt, { color: DRM_COLORS[drmMode] }]}>
                    {DRM_LABELS[drmMode]}
                    {drmMode === "clearkey" && ` · ${keyFormat === "hex" ? "Hex" : "Raw"}`}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setIsFullscreen((v) => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather
                    name={isFullscreen ? "minimize-2" : "maximize-2"}
                    size={16}
                    color={colors.mutedForeground}
                  />
                </TouchableOpacity>
              </View>

              {/* Video surface */}
              <VideoView
                ref={videoRef}
                player={player}
                style={[s.videoView, { height: isFullscreen ? screenH * 0.55 : 220 }]}
                contentFit="contain"
                allowsFullscreen
                allowsPictureInPicture
                nativeControls
              />

              {/* URL */}
              <Text
                style={[s.urlInfo, { color: colors.mutedForeground }]}
                numberOfLines={2}
              >
                {url}
              </Text>

              {/* Controls */}
              <View style={s.controls}>
                <TouchableOpacity
                  style={[s.controlBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => (player.playing ? player.pause() : player.play())}
                >
                  <Feather
                    name={player.playing ? "pause" : "play"}
                    size={18}
                    color={colors.foreground}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.controlBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => {
                    player.currentTime = 0;
                    player.play();
                  }}
                >
                  <Feather name="rotate-ccw" size={16} color={colors.foreground} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.controlBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => {
                    const src = activeSource;
                    setActiveSource(null);
                    setTimeout(() => setActiveSource(src), 100);
                  }}
                >
                  <Feather name="refresh-cw" size={16} color={colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "flex-end",
    paddingHorizontal: 20, paddingBottom: 12, gap: 12,
  },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.5, flex: 1 },
  clearBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6,
  },
  clearTxt: { fontFamily: "Inter_500Medium", fontSize: 12 },

  scroll: { paddingHorizontal: 16, paddingTop: 12, gap: 14 },

  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },

  monoInput: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 12, fontFamily: MONO,
  },

  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  pillTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  formatRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  fmtPill: {
    borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5,
  },
  fmtPillTxt: { fontFamily: "Inter_600SemiBold", fontSize: 11 },

  fieldLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },

  keyEntryRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  removeBtn: { paddingTop: 10 },

  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    alignSelf: "flex-start",
  },
  addBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  noteBanner: {
    flexDirection: "row", gap: 8, borderWidth: 1, borderRadius: 10,
    padding: 10, alignItems: "flex-start",
  },
  noteTxt: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, flex: 1 },

  testBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, borderRadius: 16, paddingVertical: 15,
  },
  testBtnTxt: { fontFamily: "Inter_700Bold", fontSize: 16 },

  playerCard: { borderWidth: 1, borderRadius: 16, overflow: "hidden" },
  playerHeaderRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusTxt: { fontFamily: "Inter_500Medium", fontSize: 12 },
  drmBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  drmBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 10 },

  videoView: { width: "100%", backgroundColor: "#000" },
  urlInfo: {
    fontFamily: "Inter_400Regular", fontSize: 10,
    paddingHorizontal: 14, paddingVertical: 8, lineHeight: 14,
  },

  controls: { flexDirection: "row", gap: 8, padding: 12, paddingTop: 4 },
  controlBtn: {
    width: 42, height: 42, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
});
