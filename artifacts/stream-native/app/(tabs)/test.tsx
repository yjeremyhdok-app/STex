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

interface KeyPair {
  id: string; // hex key ID
  key: string; // hex key
}

interface WvHeader {
  name: string;
  value: string;
}

// ── DRM badge mapping ─────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSource(url: string, drm: DrmMode, keys: KeyPair[], wvUrl: string, wvHeaders: WvHeader[]): VideoSource | null {
  if (!url.trim()) return null;

  if (drm === "none") {
    return { uri: url.trim() };
  }

  if (drm === "clearkey") {
    const clearKeys: Record<string, string> = {};
    keys.forEach((k) => {
      if (k.id.trim() && k.key.trim()) clearKeys[k.id.trim()] = k.key.trim();
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
  const [keys, setKeys] = useState<KeyPair[]>([{ id: "", key: "" }]);
  const [wvLicense, setWvLicense] = useState("");
  const [wvHeaders, setWvHeaders] = useState<WvHeader[]>([{ name: "", value: "" }]);
  const [activeSource, setActiveSource] = useState<VideoSource | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const videoRef = useRef<VideoView>(null);

  const player = useVideoPlayer(activeSource, useCallback((p) => {
    p.play();
  }, []));

  // Resolve player status
  const status = player.status;
  const isBuffering = status === "loading";
  const isPlaying = status === "readyToPlay" && player.playing;

  const handleTest = () => {
    const source = buildSource(url, drmMode, keys, wvLicense, wvHeaders);
    if (!source) {
      Alert.alert("Thiếu URL", "Nhập URL stream M3U8 trước");
      return;
    }
    setPlayerError(null);
    setActiveSource(source);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleClear = () => {
    setActiveSource(null);
    setUrl("");
    setPlayerError(null);
    setDrmMode("none");
    setKeys([{ id: "", key: "" }] as KeyPair[]);
    setWvLicense("");
    setWvHeaders([{ name: "", value: "" }]);
  };

  // ClearKey key pair helpers
  const addKeyPair = () => setKeys((prev) => [...prev, { id: "", key: "" }]);
  const removeKeyPair = (i: number) => setKeys((prev) => prev.filter((_, idx) => idx !== i));
  const updateKeyPair = (i: number, field: "id" | "key", val: string) => {
    setKeys((prev) => prev.map((k, idx) => idx === i ? { ...k, [field]: val } : k));
  };

  // Widevine header helpers
  const addWvHeader = () => setWvHeaders((prev) => [...prev, { name: "", value: "" }]);
  const removeWvHeader = (i: number) => setWvHeaders((prev) => prev.filter((_, idx) => idx !== i));
  const updateWvHeader = (i: number, field: "name" | "value", val: string) => {
    setWvHeaders((prev) => prev.map((h, idx) => idx === i ? { ...h, [field]: val } : h));
  };

  const screenH = Dimensions.get("window").height;

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Test Player</Text>
        {activeSource && (
          <TouchableOpacity style={[s.clearBtn, { borderColor: colors.border }]} onPress={handleClear}>
            <Feather name="x" size={14} color={colors.mutedForeground} />
            <Text style={[s.clearTxt, { color: colors.mutedForeground }]}>Xoá</Text>
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
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
              style={[s.urlInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="https://example.com/stream/index.m3u8"
              placeholderTextColor={colors.mutedForeground}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              multiline={false}
            />
          </View>

          {/* DRM type selector */}
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.cardHeader}>
              <Feather name="shield" size={14} color={colors.primary} />
              <Text style={[s.cardTitle, { color: colors.foreground }]}>Loại DRM</Text>
            </View>
            <View style={s.drmRow}>
              {(["none", "clearkey", "widevine"] as DrmMode[]).map((mode) => {
                const active = drmMode === mode;
                const accent = DRM_COLORS[mode];
                return (
                  <TouchableOpacity
                    key={mode}
                    style={[s.drmPill, {
                      backgroundColor: active ? accent + "20" : colors.background,
                      borderColor: active ? accent : colors.border,
                    }]}
                    onPress={() => setDrmMode(mode)}
                  >
                    {mode === "widevine" && (
                      <Feather name="lock" size={11} color={active ? accent : colors.mutedForeground} />
                    )}
                    {mode === "clearkey" && (
                      <Feather name="key" size={11} color={active ? accent : colors.mutedForeground} />
                    )}
                    {mode === "none" && (
                      <Feather name="unlock" size={11} color={active ? accent : colors.mutedForeground} />
                    )}
                    <Text style={[s.drmPillTxt, { color: active ? accent : colors.mutedForeground }]}>
                      {DRM_LABELS[mode]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ClearKey fields */}
            {drmMode === "clearkey" && (
              <View style={{ marginTop: 14, gap: 10 }}>
                <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>
                  Key ID + Key (hex) — có thể thêm nhiều cặp
                </Text>
                {keys.map((kp, i) => (
                  <View key={i} style={s.keyRow}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <TextInput
                        style={[s.hexInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                        placeholder="Key ID (hex)"
                        placeholderTextColor={colors.mutedForeground}
                        value={kp.id}
                        onChangeText={(v) => updateKeyPair(i, "id", v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <TextInput
                        style={[s.hexInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                        placeholder="Key (hex)"
                        placeholderTextColor={colors.mutedForeground}
                        value={kp.key}
                        onChangeText={(v) => updateKeyPair(i, "key", v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                    {keys.length > 1 && (
                      <TouchableOpacity style={s.removeBtn} onPress={() => removeKeyPair(i)}>
                        <Feather name="minus-circle" size={18} color="#ef4444" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <TouchableOpacity style={[s.addBtn, { borderColor: colors.border }]} onPress={addKeyPair}>
                  <Feather name="plus" size={14} color={colors.primary} />
                  <Text style={[s.addBtnTxt, { color: colors.primary }]}>Thêm key</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Widevine fields */}
            {drmMode === "widevine" && (
              <View style={{ marginTop: 14, gap: 10 }}>
                <View style={{ gap: 4 }}>
                  <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>License Server URL</Text>
                  <TextInput
                    style={[s.urlInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    placeholder="https://license.example.com/widevine"
                    placeholderTextColor={colors.mutedForeground}
                    value={wvLicense}
                    onChangeText={setWvLicense}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                </View>

                <View style={{ gap: 4 }}>
                  <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>Headers tùy chỉnh (tuỳ chọn)</Text>
                  {wvHeaders.map((h, i) => (
                    <View key={i} style={[s.keyRow, { alignItems: "center" }]}>
                      <TextInput
                        style={[s.hexInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                        placeholder="Tên header"
                        placeholderTextColor={colors.mutedForeground}
                        value={h.name}
                        onChangeText={(v) => updateWvHeader(i, "name", v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Text style={{ color: colors.mutedForeground, marginHorizontal: 4 }}>:</Text>
                      <TextInput
                        style={[s.hexInput, { flex: 1, backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                        placeholder="Giá trị"
                        placeholderTextColor={colors.mutedForeground}
                        value={h.value}
                        onChangeText={(v) => updateWvHeader(i, "value", v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {wvHeaders.length > 1 && (
                        <TouchableOpacity style={{ marginLeft: 6 }} onPress={() => removeWvHeader(i)}>
                          <Feather name="minus-circle" size={18} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity style={[s.addBtn, { borderColor: colors.border }]} onPress={addWvHeader}>
                    <Feather name="plus" size={14} color={colors.primary} />
                    <Text style={[s.addBtnTxt, { color: colors.primary }]}>Thêm header</Text>
                  </TouchableOpacity>
                </View>

                <View style={[s.noteBanner, { backgroundColor: "#3b82f620", borderColor: "#3b82f640" }]}>
                  <Feather name="info" size={12} color="#3b82f6" />
                  <Text style={[s.noteTxt, { color: "#3b82f6" }]}>
                    Widevine chỉ hoạt động trên Android. iOS dùng FairPlay.
                    Cần development build để test DRM (không hoạt động trong Expo Go).
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
            <Text style={[s.testBtnTxt, { color: colors.primaryForeground }]}>Test stream</Text>
          </TouchableOpacity>

          {/* Video player */}
          {activeSource && (
            <View style={[s.playerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {/* Player header */}
              <View style={s.playerHeaderRow}>
                <View style={s.statusDot}>
                  <View style={[s.dot, {
                    backgroundColor: isBuffering ? "#f59e0b" : isPlaying ? "#22c55e" : "#ef4444",
                  }]} />
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
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setIsFullscreen((v) => !v)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name={isFullscreen ? "minimize-2" : "maximize-2"} size={16} color={colors.mutedForeground} />
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

              {/* URL info */}
              <Text style={[s.urlInfo, { color: colors.mutedForeground }]} numberOfLines={2}>
                {url}
              </Text>

              {/* Player controls */}
              <View style={s.controls}>
                <TouchableOpacity
                  style={[s.controlBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => player.playing ? player.pause() : player.play()}
                >
                  <Feather name={player.playing ? "pause" : "play"} size={18} color={colors.foreground} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.controlBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => { player.currentTime = 0; player.play(); }}
                >
                  <Feather name="rotate-ccw" size={16} color={colors.foreground} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.controlBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => { setActiveSource(null); setTimeout(() => setActiveSource(activeSource), 100); }}
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

  urlInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  hexInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  drmRow: { flexDirection: "row", gap: 8 },
  drmPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
  },
  drmPillTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  fieldLabel: { fontFamily: "Inter_500Medium", fontSize: 12 },
  keyRow: { flexDirection: "row", gap: 8 },
  removeBtn: { justifyContent: "center", padding: 4 },
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
  statusDot: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusTxt: { fontFamily: "Inter_500Medium", fontSize: 12 },
  drmBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  drmBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 10 },

  videoView: { width: "100%", backgroundColor: "#000" },
  urlInfo: { fontFamily: "Inter_400Regular", fontSize: 10, paddingHorizontal: 14, paddingVertical: 8, lineHeight: 14 },

  controls: { flexDirection: "row", gap: 8, padding: 12, paddingTop: 4 },
  controlBtn: {
    width: 42, height: 42, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
});
