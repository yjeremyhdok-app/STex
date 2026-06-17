import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
  Alert, FlatList, Dimensions, Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useM3ULists, parseChannels, M3UList, M3UChannel } from "@/hooks/useM3ULists";
import { getDropboxToken, dropboxDownload } from "@/hooks/useDropbox";
import DropboxFilePicker from "@/components/DropboxFilePicker";

function entryCount(content: string): number {
  return (content.match(/^#EXTINF/gm) || []).length;
}
function lineCount(content: string): number {
  return content ? content.split("\n").length : 0;
}

function buildChannelRaw(ch: M3UChannel): string {
  return `${ch.extinf}\n${ch.rawUrl}`;
}

async function checkUrl(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    clearTimeout(tid);
    return res.ok || res.status === 405 || res.status === 206 || res.status === 301 || res.status === 302;
  } catch {
    return false;
  }
}

// ── List editor view ───────────────────────────────────────────────────────────

interface ListEditorProps {
  list: M3UList;
  onContentChange: (content: string) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onSetSource: (sourceUrl: string, dropboxPath?: string) => void;
  onSetAutoRefresh: (value: boolean) => void;
  onMarkRefreshed: (content: string) => void;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  insets: { bottom: number; top: number };
  scrollToTopSignal: number;
}

interface CheckState {
  checking: boolean;
  checked: number;
  total: number;
  ok: number;
  fail: number;
  done: boolean;
}

function ListEditor({
  list, onContentChange, onDelete, onRename,
  onSetSource, onSetAutoRefresh, onMarkRefreshed,
  colors, insets, scrollToTopSignal,
}: ListEditorProps) {
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(list.name);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [showDropbox, setShowDropbox] = useState(false);
  const [checkState, setCheckState] = useState<CheckState>({
    checking: false, checked: 0, total: 0, ok: 0, fail: 0, done: false,
  });

  const scrollRef = useRef<ScrollView>(null);
  const searchInputRef = useRef<TextInput>(null);
  const checkCancelRef = useRef(false);

  const entries = entryCount(list.content);
  const lines = lineCount(list.content);
  const channels = useMemo(() => parseChannels(list.content), [list.content]);

  const q = searchQuery.toLowerCase().trim();
  const filteredChannels = useMemo<M3UChannel[]>(() => {
    if (!q) return channels;
    return channels.filter(
      (ch) => ch.name.toLowerCase().includes(q) || ch.url.toLowerCase().includes(q),
    );
  }, [channels, q]);

  const channelSlice = q ? filteredChannels.slice(0, 30) : channels.slice(0, 5);

  useEffect(() => {
    if (scrollToTopSignal > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [scrollToTopSignal]);

  // Auto-refresh if >24h since last refresh
  useEffect(() => {
    if (!list.autoRefresh || !list.sourceUrl) return;
    const DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - (list.lastRefreshed ?? 0) > DAY) {
      handleRefresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (text: string) => {
    setSaving(true);
    onContentChange(text);
    setTimeout(() => setSaving(false), 300);
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    const source = list.sourceUrl;
    if (!source) return;
    setRefreshing(true);
    try {
      let content = "";
      if (list.sourceDropboxPath) {
        const token = await getDropboxToken();
        if (!token) {
          Alert.alert("Chưa kết nối Dropbox", "Mở Dropbox để kết nối lại");
          return;
        }
        content = await dropboxDownload(token, list.sourceDropboxPath);
      } else {
        const res = await fetch(source, {
          headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        content = await res.text();
      }
      onMarkRefreshed(content);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      Alert.alert("Không làm mới được", e instanceof Error ? e.message : "Lỗi không xác định");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRefreshing(false);
    }
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
      onSetSource(url);
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

  const handleDropboxImport = (content: string, name: string, dropboxPath: string) => {
    setShowDropbox(false);
    onContentChange(content);
    onSetSource(dropboxPath, dropboxPath);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleCheckChannels = async () => {
    if (checkState.checking || channels.length === 0) return;
    checkCancelRef.current = false;
    setCheckState({ checking: true, checked: 0, total: channels.length, ok: 0, fail: 0, done: false });

    const BATCH = 8;
    let okCount = 0;
    let failCount = 0;

    for (let i = 0; i < channels.length; i += BATCH) {
      if (checkCancelRef.current) break;
      const batch = channels.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((ch) => checkUrl(ch.url)));
      results.forEach((ok) => (ok ? okCount++ : failCount++));
      const newChecked = i + batch.length;
      setCheckState({
        checking: true, checked: newChecked, total: channels.length,
        ok: okCount, fail: failCount, done: false,
      });
    }

    setCheckState({ checking: false, checked: channels.length, total: channels.length, ok: okCount, fail: failCount, done: true });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const openSearch = () => {
    setSearchActive(true);
    setTimeout(() => searchInputRef.current?.focus(), 80);
  };

  const closeSearch = () => {
    setSearchActive(false);
    setSearchQuery("");
  };

  const sourceName = list.sourceDropboxPath
    ? list.sourceDropboxPath.split("/").pop() ?? "Dropbox"
    : list.sourceUrl
      ? (() => { try { return new URL(list.sourceUrl).hostname; } catch { return list.sourceUrl.slice(0, 30); } })()
      : null;

  const lastRefreshedText = list.lastRefreshed
    ? (() => {
        const diff = Date.now() - list.lastRefreshed;
        const h = Math.floor(diff / 3600000);
        if (h < 1) return "vừa xong";
        if (h < 24) return `${h}g trước`;
        return `${Math.floor(h / 24)}ng trước`;
      })()
    : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      {/* Top cards — scrollable, capped so editor always has room */}
      <ScrollView
        ref={scrollRef}
        style={{ maxHeight: Dimensions.get("window").height * 0.52 }}
        contentContainerStyle={[se.scroll, { paddingBottom: 8 }]}
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
            <View style={{ gap: 10 }}>
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

              {/* Source bar */}
              {sourceName && (
                <View style={[se.sourceBar, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Feather
                    name={list.sourceDropboxPath ? "box" : "link"}
                    size={12}
                    color={list.sourceDropboxPath ? "#0061ff" : colors.primary}
                  />
                  <Text style={[se.sourceName, { color: colors.mutedForeground, flex: 1 }]} numberOfLines={1}>
                    {sourceName}
                  </Text>
                  {lastRefreshedText && (
                    <Text style={[se.sourceTime, { color: colors.mutedForeground }]}>{lastRefreshedText}</Text>
                  )}
                  <TouchableOpacity onPress={handleRefresh} disabled={refreshing}>
                    {refreshing
                      ? <ActivityIndicator size="small" color={colors.primary} style={{ width: 20 }} />
                      : <Feather name="refresh-cw" size={14} color={colors.primary} />}
                  </TouchableOpacity>
                </View>
              )}

              {/* Auto-refresh toggle — only show if source exists */}
              {list.sourceUrl && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Feather name="clock" size={12} color={colors.mutedForeground} />
                  <Text style={[se.autoLabel, { color: colors.mutedForeground, flex: 1 }]}>Tự động làm mới hằng ngày</Text>
                  <Switch
                    value={!!list.autoRefresh}
                    onValueChange={(v) => onSetAutoRefresh(v)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#fff"
                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                  />
                </View>
              )}
            </View>
          )}
        </View>

        {/* Dropbox connect */}
        <TouchableOpacity
          style={[se.dropboxBtn, { backgroundColor: "#0061ff15", borderColor: "#0061ff40" }]}
          onPress={() => setShowDropbox(true)}
          activeOpacity={0.75}
        >
          <Feather name="box" size={16} color="#0061ff" />
          <Text style={[se.dropboxTxt, { color: "#0061ff" }]}>
            {list.sourceDropboxPath ? "Đổi file Dropbox" : "Mở từ Dropbox"}
          </Text>
          <Feather name="chevron-right" size={14} color="#0061ff80" />
        </TouchableOpacity>

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
        {(channels.length > 0) && (
          <View style={[se.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Card header with check button */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
              <Feather name="list" size={14} color="#22c55e" />
              <Text style={[se.cardTitle, { color: colors.foreground, flex: 1 }]}>
                {q ? `${filteredChannels.length} kết quả` : `${channels.length} kênh`}
              </Text>

              {/* Channel check result badge */}
              {checkState.done && !checkState.checking && (
                <View style={[se.checkBadge, { backgroundColor: "#22c55e20" }]}>
                  <Feather name="check-circle" size={10} color="#22c55e" />
                  <Text style={[se.checkBadgeTxt, { color: "#22c55e" }]}>{checkState.ok}</Text>
                  {checkState.fail > 0 && (
                    <>
                      <Text style={[se.checkBadgeTxt, { color: colors.mutedForeground }]}>·</Text>
                      <Feather name="x-circle" size={10} color="#ef4444" />
                      <Text style={[se.checkBadgeTxt, { color: "#ef4444" }]}>{checkState.fail}</Text>
                    </>
                  )}
                </View>
              )}

              {/* Checking progress */}
              {checkState.checking && (
                <Text style={[se.checkBadgeTxt, { color: colors.mutedForeground }]}>
                  {checkState.checked}/{checkState.total}
                </Text>
              )}

              {/* Check button */}
              <TouchableOpacity
                style={[se.checkBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                onPress={checkState.checking ? () => { checkCancelRef.current = true; } : handleCheckChannels}
                disabled={channels.length === 0}
              >
                {checkState.checking
                  ? <><ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 4 }} /><Text style={[se.checkBtnTxt, { color: "#ef4444" }]}>Dừng</Text></>
                  : <><Feather name="wifi" size={12} color={colors.primary} /><Text style={[se.checkBtnTxt, { color: colors.primary }]}>Kiểm tra</Text></>}
              </TouchableOpacity>
            </View>

            {/* Channel rows */}
            {channelSlice.length === 0 && q ? (
              <Text style={[se.moreText, { color: colors.mutedForeground }]}>Không tìm thấy kênh nào</Text>
            ) : (
              channelSlice.map((ch, i) => (
                <View key={i} style={[se.chRow, { borderTopColor: colors.border, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0 }]}>
                  <Text style={[se.chName, { color: colors.foreground }]} numberOfLines={1}>{ch.name}</Text>
                  <Text style={[se.chUrl, { color: colors.mutedForeground }]} numberOfLines={1}>{ch.url}</Text>
                </View>
              ))
            )}
            {!q && channels.length > 5 && (
              <Text style={[se.moreText, { color: colors.mutedForeground }]}>+{channels.length - 5} kênh nữa...</Text>
            )}
            {q && filteredChannels.length > 30 && (
              <Text style={[se.moreText, { color: colors.mutedForeground }]}>+{filteredChannels.length - 30} kết quả nữa...</Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Raw editor — sticky header + scrollable content */}
      <View style={[se.editorWrap, { flex: 1, backgroundColor: colors.card, borderColor: colors.border, marginHorizontal: 16, marginBottom: insets.bottom + 16 }]}>
        {/* Header: label OR search input */}
        <View style={[se.editorHeader, { borderBottomColor: colors.border }]}>
          {searchActive ? (
            <>
              <Feather name="search" size={14} color={colors.primary} />
              <TextInput
                ref={searchInputRef}
                style={[se.searchInput, { color: colors.foreground, flex: 1 }]}
                placeholder="Tìm kênh..."
                placeholderTextColor={colors.mutedForeground}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              <TouchableOpacity onPress={closeSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Feather name="file-text" size={14} color={colors.mutedForeground} />
              <Text style={[se.editorLabel, { color: colors.mutedForeground, flex: 1 }]}>Nội dung M3U thô</Text>
              <TouchableOpacity onPress={openSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="search" size={15} color={colors.mutedForeground} />
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Content: filtered read-only OR editable */}
        {q ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 14, paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {filteredChannels.length === 0 ? (
              <Text style={[se.editor, { color: colors.mutedForeground, minHeight: undefined }]}>
                Không tìm thấy kênh nào khớp với "{searchQuery}"
              </Text>
            ) : (
              filteredChannels.map((ch, i) => (
                <View key={i} style={{ marginBottom: 14 }}>
                  <Text style={[se.editor, { color: colors.foreground, minHeight: undefined }]} selectable>
                    {ch.extinf}
                  </Text>
                  <Text style={[se.editor, { color: colors.primary, minHeight: undefined }]} selectable>
                    {ch.url}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        ) : (
          <TextInput
            style={[se.editor, { color: colors.foreground, flex: 1 }]}
            placeholder={"#EXTM3U\n#EXTINF:-1,Tên kênh\nhttps://stream.url/live.m3u8"}
            placeholderTextColor={colors.mutedForeground}
            value={list.content}
            onChangeText={handleChange}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            textAlignVertical="top"
            scrollEnabled={true}
          />
        )}
      </View>

      {/* Dropbox file picker modal */}
      <DropboxFilePicker
        visible={showDropbox}
        onClose={() => setShowDropbox(false)}
        onImport={handleDropboxImport}
      />
    </KeyboardAvoidingView>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function M3UScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    lists, loading, reload, createList, updateContent, renameList, deleteList,
    setSource, setAutoRefresh, markRefreshed,
  } = useM3ULists();

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [newName, setNewName] = useState("");
  const [scrollSignals, setScrollSignals] = useState<Record<string, number>>({});

  const effectiveId = selectedId ?? lists[0]?.id ?? null;
  const selectedList = lists.find((l) => l.id === effectiveId) ?? null;

  const handleTabPress = (id: string) => {
    if (id === effectiveId) {
      setScrollSignals((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    } else {
      setSelectedId(id);
    }
  };

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
                  onPress={() => handleTabPress(item.id)}
                >
                  {item.sourceDropboxPath && (
                    <Feather name="box" size={10} color={active ? colors.primaryForeground + "cc" : "#0061ff"} />
                  )}
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
          onSetSource={(url, dp) => setSource(selectedList.id, url, dp)}
          onSetAutoRefresh={(v) => setAutoRefresh(selectedList.id, v)}
          onMarkRefreshed={(c) => markRefreshed(selectedList.id, c)}
          colors={colors}
          insets={insets}
          scrollToTopSignal={scrollSignals[selectedList.id] ?? 0}
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
  tab: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, maxWidth: 160 },
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

  sourceBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
  },
  sourceName: { fontFamily: "Inter_400Regular", fontSize: 12 },
  sourceTime: { fontFamily: "Inter_400Regular", fontSize: 11 },
  autoLabel: { fontFamily: "Inter_400Regular", fontSize: 12 },

  dropboxBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 14, padding: 14,
  },
  dropboxTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 },

  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  urlInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  importBtn: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  pasteBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 14 },
  pasteTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 },
  pasteHint: { fontFamily: "Inter_400Regular", fontSize: 12 },

  checkBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5,
  },
  checkBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  checkBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3,
  },
  checkBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 10 },

  chRow: { paddingVertical: 8, gap: 2 },
  chName: { fontFamily: "Inter_500Medium", fontSize: 14 },
  chUrl: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11 },
  moreText: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 6, textAlign: "center" },

  editorWrap: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  editorHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  editorLabel: { fontFamily: "Inter_500Medium", fontSize: 13 },
  searchInput: { fontFamily: "Inter_400Regular", fontSize: 13, paddingVertical: 0, height: 24 },
  editor: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 18, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, minHeight: 280 },
});
