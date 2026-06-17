import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useColors } from "@/hooks/useColors";

const STORAGE_KEY = "@m3u_list_content";

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function entryCount(text: string): number {
  if (!text) return 0;
  return (text.match(/^#EXTINF/gm) || []).length;
}

export default function M3UScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [content, setContent] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => { if (v) setContent(v); })
      .catch(() => {});
  }, []);

  const saveContent = useCallback(async (text: string) => {
    setSaving(true);
    try { await AsyncStorage.setItem(STORAGE_KEY, text); } catch { /* ignore */ }
    setSaving(false);
  }, []);

  const handleChange = (text: string) => {
    setContent(text);
    saveContent(text);
  };

  const handleImportUrl = async () => {
    const url = importUrl.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      Alert.alert("URL không hợp lệ", "Vui lòng nhập URL bắt đầu bằng http:// hoặc https://");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          "Accept": "*/*",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setContent(text);
      saveContent(text);
      setImportUrl("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Lỗi không xác định";
      Alert.alert("Không tải được", `Lỗi: ${msg}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setImporting(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text) { Alert.alert("Clipboard trống", "Không có nội dung trong clipboard"); return; }
      setContent(text);
      saveContent(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Lỗi", "Không đọc được clipboard");
    }
  };

  const handleCopyAll = async () => {
    if (!content) { Alert.alert("Danh sách trống", "Không có nội dung để sao chép"); return; }
    await Clipboard.setStringAsync(content);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    Alert.alert("Xoá danh sách?", "Toàn bộ nội dung sẽ bị xoá", [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Xoá",
        style: "destructive",
        onPress: () => {
          setContent("");
          saveContent("");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  };

  const lines = lineCount(content);
  const entries = entryCount(content);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>M3U List</Text>
          {content ? (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              {entries > 0 ? `${entries} kênh` : `${lines} dòng`}
              {saving && <Text style={{ color: colors.mutedForeground }}> · Đang lưu...</Text>}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {!!content && (
            <TouchableOpacity
              style={[styles.headerBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={handleClear}
            >
              <Feather name="trash-2" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.headerBtn, {
              borderColor: copied ? "#22c55e" : colors.primary,
              backgroundColor: copied ? "#22c55e" : colors.primary,
            }]}
            onPress={handleCopyAll}
          >
            <Feather name={copied ? "check" : "copy"} size={16} color="#fff" />
            <Text style={[styles.headerBtnTxt, { color: "#fff" }]}>
              {copied ? "Đã chép!" : "Sao chép"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Import from URL */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <Feather name="download" size={15} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Nhập từ URL</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                style={[styles.urlInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, flex: 1 }]}
                placeholder="https://example.com/playlist.m3u"
                placeholderTextColor={colors.mutedForeground}
                value={importUrl}
                onChangeText={setImportUrl}
                autoCapitalize="none"
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={handleImportUrl}
                editable={!importing}
              />
              <TouchableOpacity
                style={[styles.importBtn, { backgroundColor: colors.primary, opacity: importing ? 0.7 : 1 }]}
                onPress={handleImportUrl}
                disabled={importing}
              >
                {importing
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Feather name="download-cloud" size={18} color="#fff" />
                }
              </TouchableOpacity>
            </View>
          </View>

          {/* Paste from clipboard */}
          <TouchableOpacity
            style={[styles.pasteBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handlePasteClipboard}
            activeOpacity={0.75}
          >
            <Feather name="clipboard" size={16} color={colors.primary} />
            <Text style={[styles.pasteTxt, { color: colors.foreground }]}>Dán từ clipboard</Text>
            <Text style={[styles.pasteHint, { color: colors.mutedForeground }]}>Dán M3U hoặc URL list đã chép</Text>
          </TouchableOpacity>

          {/* Text editor */}
          <View style={[styles.editorWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.editorHeader, { borderBottomColor: colors.border }]}>
              <Feather name="file-text" size={14} color={colors.mutedForeground} />
              <Text style={[styles.editorHeaderTxt, { color: colors.mutedForeground }]}>Nội dung M3U</Text>
              {!!content && (
                <View style={[styles.linesBadge, { backgroundColor: colors.primary + "20" }]}>
                  <Text style={[styles.linesBadgeTxt, { color: colors.primary }]}>
                    {lines} dòng
                  </Text>
                </View>
              )}
            </View>
            <TextInput
              style={[styles.editor, { color: colors.foreground, backgroundColor: colors.card }]}
              placeholder={"#EXTM3U\n#EXTINF:-1,Tên kênh\nhttps://stream.url/live.m3u8"}
              placeholderTextColor={colors.mutedForeground}
              value={content}
              onChangeText={handleChange}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
              scrollEnabled={false}
            />
            {!content && (
              <View style={styles.editorEmptyHint}>
                <Feather name="arrow-up" size={14} color={colors.mutedForeground} style={{ opacity: 0.5 }} />
                <Text style={[styles.editorEmptyTxt, { color: colors.mutedForeground }]}>
                  Nhập từ URL hoặc dán nội dung M3U vào đây
                </Text>
              </View>
            )}
          </View>

          {/* Quick info */}
          {!!content && entries > 0 && (
            <View style={[styles.infoBox, { backgroundColor: "#22c55e10", borderColor: "#22c55e30" }]}>
              <Feather name="check-circle" size={14} color="#22c55e" />
              <Text style={{ fontSize: 12, color: "#22c55e", fontFamily: "Inter_500Medium" }}>
                Đã có {entries} kênh · {lines} dòng
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, flexDirection: "row", alignItems: "flex-end", gap: 10 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.5 },
  headerSub: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  headerBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
  },
  headerBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13 },

  scrollContent: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },

  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },

  urlInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44,
    fontSize: 13, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  importBtn: {
    width: 44, height: 44, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },

  pasteBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  pasteTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 },
  pasteHint: { fontFamily: "Inter_400Regular", fontSize: 12 },

  editorWrapper: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  editorHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editorHeaderTxt: { fontFamily: "Inter_500Medium", fontSize: 13, flex: 1 },
  linesBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  linesBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 11 },
  editor: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12, lineHeight: 18,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14,
    minHeight: 300,
  },
  editorEmptyHint: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingBottom: 14, marginTop: -8,
  },
  editorEmptyTxt: { fontFamily: "Inter_400Regular", fontSize: 12 },

  infoBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 10, padding: 10,
  },
});
