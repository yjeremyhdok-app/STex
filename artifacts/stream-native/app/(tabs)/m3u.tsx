import React, { useState, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
  Alert, FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useM3ULists, parseChannels, M3UList } from "@/hooks/useM3ULists";

function entryCount(content: string): number {
  return (content.match(/^#EXTINF/gm) || []).length;
}
function lineCount(content: string): number {
  return content ? content.split("\n").length : 0;
}

// ── List editor view ───────────────────────────────────────────────────────────

interface ListEditorProps {
  list: M3UList;
  onContentChange: (content: string) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  insets: { bottom: number; top: number };
}

function ListEditor({ list, onContentChange, onDelete, onRename, colors, insets }: ListEditorProps) {
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(list.name);

  const entries = entryCount(list.content);
  const lines = lineCount(list.content);
  const channels = useMemo(() => parseChannels(list.content), [list.content]);

  const handleChange = (text: string) => {
    setSaving(true);
    onContentChange(text);
    setTimeout(() => setSaving(false), 300);
  };

  const handleImportUrl = async () => {
    const url = importUrl.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      Alert.alert("URL không hợp lệ", "URL phải bắt đầu bằng http:// hoặc https://");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15", "Accept": "*/*" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      onContentChange(text);
      setImportUrl("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Lỗi không xác định";
      Alert.alert("Không tải được", msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setImporting(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text) { Alert.alert("Clipboard trống", "Không có nội dung"); return; }
      onContentChange(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { Alert.alert("Lỗi", "Không đọc được clipboard"); }
  };

  const handleCopy = async () => {
    if (!list.content) { Alert.alert("Trống", "Không có nội dung để sao chép"); return; }
    await Clipboard.setStringAsync(list.content);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRename = () => {
    const n = newName.trim();
    if (!n) return;
    onRename(n);
    setRenaming(false);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[se.scroll, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* List name + actions */}
        <View style={[se.nameBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {renaming ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput
                style={[se.nameInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, flex: 1 }]}
                value={newName}
                onChangeText={setNewName}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleRename}
              />
              <TouchableOpacity style={[se.smallBtn, { backgroundColor: colors.primary }]} onPress={handleRename}>
                <Feather name="check" size={16} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={[se.smallBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} onPress={() => { setRenaming(false); setNewName(list.name); }}>
                <Feather name="x" size={16} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[se.nameText, { color: colors.foreground }]} numberOfLines={1}>{list.name}</Text>
                <Text style={[se.nameMeta, { color: colors.mutedForeground }]}>
                  {entries > 0 ? `${entries} kênh · ` : ""}{lines} dòng
                  {saving ? " · Đang lưu..." : ""}
                </Text>
              </View>
              <TouchableOpacity style={se.iconBtn} onPress={() => setRenaming(true)}>
                <Feather name="edit-2" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[se.copyBtn, { borderColor: copied ? "#22c55e" : colors.primary, backgroundColor: copied ? "#22c55e" : colors.primary }]}
                onPress={handleCopy}
              >
                <Feather name={copied ? "check" : "copy"} size={14} color="#fff" />
                <Text style={[se.copyTxt, { color: "#fff" }]}>{copied ? "Đã chép!" : "Sao chép"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={se.iconBtn} onPress={() => Alert.alert("Xoá danh sách?", `Xoá "${list.name}"?`, [
                { text: "Huỷ", style: "cancel" },
                { text: "Xoá", style: "destructive", onPress: onDelete },
              ])}>
                <Feather name="trash-2" size={16} color="#ef4444" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Import from URL */}
        <View style={[se.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Feather name="download" size={14} color={colors.primary} />
            <Text style={[se.cardTitle, { color: colors.foreground }]}>Nhập từ URL</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[se.urlInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, flex: 1 }]}
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
            <TouchableOpacity style={[se.importBtn, { backgroundColor: colors.primary, opacity: importing ? 0.7 : 1 }]} onPress={handleImportUrl} disabled={importing}>
              {importing ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="download-cloud" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>

        {/* Paste */}
        <TouchableOpacity style={[se.pasteBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={handlePaste} activeOpacity={0.75}>
          <Feather name="clipboard" size={16} color={colors.primary} />
          <Text style={[se.pasteTxt, { color: colors.foreground }]}>Dán từ clipboard</Text>
          <Text style={[se.pasteHint, { color: colors.mutedForeground }]}>Dán nội dung M3U</Text>
        </TouchableOpacity>

        {/* Channel list preview */}
        {channels.length > 0 && (
          <View style={[se.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <Feather name="list" size={14} color="#22c55e" />
              <Text style={[se.cardTitle, { color: colors.foreground }]}>{channels.length} kênh</Text>
            </View>
            {channels.slice(0, 5).map((ch, i) => (
              <View key={i} style={[se.chRow, { borderTopColor: colors.border, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0 }]}>
                <Text style={[se.chName, { color: colors.foreground }]} numberOfLines={1}>{ch.name}</Text>
                <Text style={[se.chUrl, { color: colors.mutedForeground }]} numberOfLines={1}>{ch.url}</Text>
              </View>
            ))}
            {channels.length > 5 && (
              <Text style={[se.moreText, { color: colors.mutedForeground }]}>+{channels.length - 5} kênh nữa...</Text>
            )}
          </View>
        )}

        {/* Raw editor */}
        <View style={[se.editorWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[se.editorHeader, { borderBottomColor: colors.border }]}>
            <Feather name="file-text" size={14} color={colors.mutedForeground} />
            <Text style={[se.editorLabel, { color: colors.mutedForeground }]}>Nội dung M3U thô</Text>
          </View>
          <TextInput
            style={[se.editor, { color: colors.foreground }]}
            placeholder={"#EXTM3U\n#EXTINF:-1,Tên kênh\nhttps://stream.url/live.m3u8"}
            placeholderTextColor={colors.mutedForeground}
            value={list.content}
            onChangeText={handleChange}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            textAlignVertical="top"
            scrollEnabled={false}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function M3UScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { lists, loading, createList, updateContent, renameList, deleteList } = useM3ULists();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [newName, setNewName] = useState("");

  const effectiveId = selectedId ?? lists[0]?.id ?? null;
  const selectedList = lists.find((l) => l.id === effectiveId) ?? null;

  const handleCreate = () => {
    const n = newName.trim();
    if (!n) return;
    const created = createList(n);
    setSelectedId(created.id);
    setNewName("");
    setShowNewList(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDelete = (id: string) => {
    deleteList(id);
    if (effectiveId === id) setSelectedId(null);
  };

  if (loading) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>M3U</Text>
        <TouchableOpacity
          style={[s.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => setShowNewList((v) => !v)}
        >
          <Feather name={showNewList ? "x" : "plus"} size={18} color={colors.primaryForeground} />
          <Text style={[s.addBtnTxt, { color: colors.primaryForeground }]}>Danh sách mới</Text>
        </TouchableOpacity>
      </View>

      {/* New list form */}
      {showNewList && (
        <View style={[s.newBox, { backgroundColor: colors.card, borderColor: colors.primary + "60" }]}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[s.newInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, flex: 1 }]}
              placeholder="Tên danh sách..."
              placeholderTextColor={colors.mutedForeground}
              value={newName}
              onChangeText={setNewName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
            <TouchableOpacity style={[s.createBtn, { backgroundColor: colors.primary }]} onPress={handleCreate}>
              <Text style={[s.createTxt, { color: colors.primaryForeground }]}>Tạo</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* List tabs */}
      {lists.length > 0 && (
        <View style={[s.tabsWrapper, { borderBottomColor: colors.border }]}>
          <FlatList
            horizontal
            data={lists}
            keyExtractor={(l) => l.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 10 }}
            renderItem={({ item }) => {
              const active = item.id === effectiveId;
              return (
                <TouchableOpacity
                  style={[s.tab, {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  }]}
                  onPress={() => setSelectedId(item.id)}
                >
                  <Text style={[s.tabTxt, { color: active ? colors.primaryForeground : colors.foreground }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {entryCount(item.content) > 0 && (
                    <View style={[s.tabBadge, { backgroundColor: active ? colors.primaryForeground + "30" : colors.primary + "20" }]}>
                      <Text style={[s.tabBadgeTxt, { color: active ? colors.primaryForeground : colors.primary }]}>
                        {entryCount(item.content)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* Empty state */}
      {lists.length === 0 && !showNewList && (
        <View style={s.empty}>
          <Feather name="film" size={52} color={colors.mutedForeground} style={{ opacity: 0.3 }} />
          <Text style={[s.emptyTitle, { color: colors.foreground }]}>Chưa có danh sách M3U</Text>
          <Text style={[s.emptySub, { color: colors.mutedForeground }]}>Nhấn "Danh sách mới" để tạo</Text>
          <TouchableOpacity style={[s.emptyBtn, { backgroundColor: colors.primary }]} onPress={() => setShowNewList(true)}>
            <Feather name="plus" size={18} color={colors.primaryForeground} />
            <Text style={[s.emptyBtnTxt, { color: colors.primaryForeground }]}>Tạo danh sách đầu tiên</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Editor */}
      {selectedList && (
        <ListEditor
          key={selectedList.id}
          list={selectedList}
          onContentChange={(c) => updateContent(selectedList.id, c)}
          onDelete={() => handleDelete(selectedList.id)}
          onRename={(n) => renameList(selectedList.id, n)}
          colors={colors}
          insets={insets}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.5, flex: 1 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  addBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13 },

  newBox: { marginHorizontal: 16, marginBottom: 8, borderWidth: 1.5, borderRadius: 14, padding: 12 },
  newInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 14 },
  createBtn: { paddingHorizontal: 18, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  createTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14 },

  tabsWrapper: { borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, maxWidth: 160 },
  tabTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13, flexShrink: 1 },
  tabBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  tabBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 10 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 20, textAlign: "center" },
  emptySub: { fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, marginTop: 8 },
  emptyBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
});

const se = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },

  nameBox: { borderWidth: 1, borderRadius: 14, padding: 14 },
  nameText: { fontFamily: "Inter_700Bold", fontSize: 18 },
  nameMeta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  nameInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 42, fontSize: 15 },
  iconBtn: { padding: 6 },
  smallBtn: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  copyTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  urlInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  importBtn: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  pasteBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 14 },
  pasteTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 },
  pasteHint: { fontFamily: "Inter_400Regular", fontSize: 12 },

  chRow: { paddingVertical: 8, gap: 2 },
  chName: { fontFamily: "Inter_500Medium", fontSize: 14 },
  chUrl: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11 },
  moreText: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 6, textAlign: "center" },

  editorWrap: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  editorHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  editorLabel: { fontFamily: "Inter_500Medium", fontSize: 13 },
  editor: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 18, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, minHeight: 280 },
});
