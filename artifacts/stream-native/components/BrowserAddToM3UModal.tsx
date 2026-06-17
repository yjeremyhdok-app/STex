import React, { useState, useEffect, useMemo } from "react";
import {
  Modal, View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useM3ULists, parseChannels, M3UList, M3UChannel, M3UHeaders } from "@/hooks/useM3ULists";

type Step = "list" | "channels" | "edit";

interface Props {
  visible: boolean;
  onClose: () => void;
  prefillUrl: string;
  prefillPageUrl: string;
}

const EMPTY_HEADERS: M3UHeaders = { referer: "", userAgent: "", cookie: "", authorization: "" };

function guessName(pageUrl: string): string {
  if (!pageUrl) return "";
  try { return new URL(pageUrl).hostname.replace(/^www\./, "").split(".")[0]; } catch { return ""; }
}

export function BrowserAddToM3UModal({ visible, onClose, prefillUrl, prefillPageUrl }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { lists, loading, reload, createList, addChannel, updateChannel } = useM3ULists();

  const [step, setStep] = useState<Step>("list");
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editChannel, setEditChannel] = useState<M3UChannel | null>(null); // null = new channel

  // Form fields
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<M3UHeaders>(EMPTY_HEADERS);
  const [toggles, setToggles] = useState({ referer: false, userAgent: false, cookie: false, authorization: false });
  const [saving, setSaving] = useState(false);

  // New list creation inline
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setEditChannel(null);
    setName(guessName(prefillPageUrl));
    setUrl(prefillUrl);
    setHeaders({ ...EMPTY_HEADERS, referer: prefillPageUrl ? (() => { try { return new URL(prefillPageUrl).origin + "/"; } catch { return ""; } })() : "" });
    setToggles({ referer: !!prefillPageUrl, userAgent: false, cookie: false, authorization: false });
    setNewListName("");
    setCreatingList(false);
    setStep("list");

    // Reload from storage so we see lists created in other tabs, then auto-advance
    reload().then((freshLists) => {
      if (freshLists.length === 1) {
        setSelectedListId(freshLists[0].id);
        setStep("channels");
      } else {
        setStep("list");
      }
    }).catch(() => setStep("list"));
  }, [visible, prefillPageUrl, prefillUrl, reload]);

  const selectedList = lists.find((l) => l.id === selectedListId) ?? null;
  const channels = useMemo(() => selectedList ? parseChannels(selectedList.content) : [], [selectedList]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? channels.filter((c) => c.name.toLowerCase().includes(q) || c.url.toLowerCase().includes(q)) : channels;
  }, [channels, search]);

  const setHeader = (key: keyof M3UHeaders, val: string) => setHeaders((h) => ({ ...h, [key]: val }));
  const setToggle = (key: keyof typeof toggles, val: boolean) => {
    setToggles((t) => ({ ...t, [key]: val }));
    if (!val) setHeader(key as keyof M3UHeaders, "");
  };

  const pickList = (list: M3UList) => {
    setSelectedListId(list.id);
    setStep("channels");
  };

  const pickChannel = (ch: M3UChannel | null) => {
    const pageReferer = prefillPageUrl
      ? (() => { try { return new URL(prefillPageUrl).origin + "/"; } catch { return ""; } })()
      : "";

    if (ch) {
      setEditChannel(ch);
      setName(ch.name);
      setUrl(ch.url); // user can replace via "Thay đổi" button
      // Merge: channel's saved headers take priority; fall back to browser prefills for empty fields
      const h: M3UHeaders = {
        referer: ch.headers.referer || pageReferer,
        userAgent: ch.headers.userAgent || "",
        cookie: ch.headers.cookie || "",
        authorization: ch.headers.authorization || "",
      };
      setHeaders(h);
      setToggles({
        referer: !!h.referer,
        userAgent: !!h.userAgent,
        cookie: !!h.cookie,
        authorization: !!h.authorization,
      });
    } else {
      setEditChannel(null);
      setName(guessName(prefillPageUrl));
      setUrl(prefillUrl);
      const h: M3UHeaders = { ...EMPTY_HEADERS, referer: pageReferer };
      setHeaders(h);
      setToggles({ referer: !!pageReferer, userAgent: false, cookie: false, authorization: false });
    }
    setStep("edit");
  };

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("Thiếu tên", "Nhập tên kênh"); return; }
    if (!url.trim()) { Alert.alert("Thiếu URL", "Nhập stream URL"); return; }
    if (!selectedListId) return;
    setSaving(true);
    const h: M3UHeaders = {
      referer: toggles.referer ? headers.referer : "",
      userAgent: toggles.userAgent ? headers.userAgent : "",
      cookie: toggles.cookie ? headers.cookie : "",
      authorization: toggles.authorization ? headers.authorization : "",
    };
    try {
      if (editChannel) {
        updateChannel(selectedListId, editChannel, name.trim(), url.trim(), h);
      } else {
        addChannel(selectedListId, name.trim(), url.trim(), h);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleCreateList = () => {
    const n = newListName.trim();
    if (!n) { Alert.alert("Thiếu tên", "Nhập tên danh sách"); return; }
    setCreatingList(true);
    const created = createList(n);
    setSelectedListId(created.id);
    setNewListName("");
    setCreatingList(false);
    setStep("channels");
  };

  const back = () => {
    if (step === "edit") { setStep("channels"); return; }
    if (step === "channels") { if (lists.length > 1) { setStep("list"); } else { onClose(); } return; }
    onClose();
  };

  const title = step === "list" ? "Chọn danh sách M3U"
    : step === "channels" ? (selectedList?.name ?? "Chọn kênh")
    : editChannel ? "Sửa kênh" : "Thêm kênh mới";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[s.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={back} style={s.backBtn}>
            <Feather name={step === "list" ? "x" : "chevron-left"} size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.title, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
          {step === "edit" ? (
            <TouchableOpacity onPress={handleSave} disabled={saving} style={[s.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}>
              {saving ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[s.saveTxt, { color: colors.primaryForeground }]}>Lưu</Text>}
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        {/* ── Step: list picker ── */}
        {step === "list" && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 30 }]}>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <>
                {lists.map((l) => {
                  const ch = parseChannels(l.content);
                  return (
                    <TouchableOpacity key={l.id} style={[s.listItem, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => pickList(l)} activeOpacity={0.75}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.listName, { color: colors.foreground }]} numberOfLines={1}>{l.name}</Text>
                        <Text style={[s.listMeta, { color: colors.mutedForeground }]}>{ch.length} kênh</Text>
                      </View>
                      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  );
                })}

                {/* Create new list */}
                <View style={[s.newListBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[s.newListLabel, { color: colors.foreground }]}>
                    <Feather name="plus" size={14} color={colors.primary} />{"  "}Tạo danh sách mới
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    <TextInput
                      style={[s.newListInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, flex: 1 }]}
                      placeholder="Tên danh sách..."
                      placeholderTextColor={colors.mutedForeground}
                      value={newListName}
                      onChangeText={setNewListName}
                      returnKeyType="done"
                      onSubmitEditing={handleCreateList}
                    />
                    <TouchableOpacity style={[s.createBtn, { backgroundColor: colors.primary }]} onPress={handleCreateList} disabled={creatingList}>
                      <Text style={[s.createBtnTxt, { color: colors.primaryForeground }]}>Tạo</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        )}

        {/* ── Step: channel picker ── */}
        {step === "channels" && (
          <View style={{ flex: 1 }}>
            {/* Search bar */}
            <View style={[s.searchBar, { backgroundColor: colors.card, borderColor: colors.border, margin: 12 }]}>
              <Feather name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[s.searchInput, { color: colors.foreground }]}
                placeholder="Tìm kênh..."
                placeholderTextColor={colors.mutedForeground}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
              />
              {!!search && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <Feather name="x" size={15} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item, i) => `${item.urlLine}-${i}`}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 80, gap: 8 }}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <TouchableOpacity
                  style={[s.newChannelBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "50" }]}
                  onPress={() => pickChannel(null)}
                >
                  <Feather name="plus-circle" size={16} color={colors.primary} />
                  <Text style={[s.newChannelTxt, { color: colors.primary }]}>Thêm kênh mới vào "{selectedList?.name}"</Text>
                </TouchableOpacity>
              }
              ListEmptyComponent={
                <View style={s.empty}>
                  <Feather name="list" size={32} color={colors.mutedForeground + "60"} />
                  <Text style={[s.emptyTxt, { color: colors.mutedForeground }]}>
                    {search ? "Không tìm thấy kênh" : "Danh sách trống — thêm kênh đầu tiên"}
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.channelItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => pickChannel(item)}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[s.channelName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[s.channelUrl, { color: colors.mutedForeground }]} numberOfLines={1}>{item.url}</Text>
                    {(item.headers.referer || item.headers.cookie) && (
                      <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
                        {item.headers.referer && <View style={[s.hBadge, { backgroundColor: "#3b82f618", borderColor: "#3b82f640" }]}><Text style={[s.hBadgeTxt, { color: "#3b82f6" }]}>REF</Text></View>}
                        {item.headers.cookie && <View style={[s.hBadge, { backgroundColor: "#f59e0b18", borderColor: "#f59e0b40" }]}><Text style={[s.hBadgeTxt, { color: "#f59e0b" }]}>COOKIE</Text></View>}
                        {item.headers.userAgent && <View style={[s.hBadge, { backgroundColor: "#10b98118", borderColor: "#10b98140" }]}><Text style={[s.hBadgeTxt, { color: "#10b981" }]}>UA</Text></View>}
                        {item.headers.authorization && <View style={[s.hBadge, { backgroundColor: "#a855f718", borderColor: "#a855f740" }]}><Text style={[s.hBadgeTxt, { color: "#a855f7" }]}>AUTH</Text></View>}
                      </View>
                    )}
                  </View>
                  <Feather name="edit-2" size={15} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* ── Step: edit channel ── */}
        {step === "edit" && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.editContent, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

              {/* Stream URL section */}
              {editChannel ? (
                /* Editing existing channel: show current + new side-by-side with change button */
                <View style={{ gap: 8, marginBottom: 16 }}>
                  {/* Current saved URL */}
                  <View style={[s.urlPreview, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <View style={[s.streamBadge, { backgroundColor: colors.mutedForeground + "20" }]}>
                        <Text style={[s.streamBadgeTxt, { color: colors.mutedForeground }]}>URL HIỆN TẠI</Text>
                      </View>
                      <TouchableOpacity
                        style={[s.changeBtn, { backgroundColor: "#f59e0b18", borderColor: "#f59e0b50" }]}
                        onPress={() => Alert.alert(
                          "Thay đổi Stream URL?",
                          `Thay thế:\n${editChannel.url}\n\nBằng URL mới:\n${prefillUrl}`,
                          [
                            { text: "Huỷ", style: "cancel" },
                            {
                              text: "Thay đổi",
                              style: "destructive",
                              onPress: () => setUrl(prefillUrl),
                            },
                          ],
                        )}
                      >
                        <Feather name="refresh-cw" size={13} color="#f59e0b" />
                        <Text style={[s.changeBtnTxt, { color: "#f59e0b" }]}>Thay đổi</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={[s.urlReadonly, s.mono, { color: url !== editChannel.url ? colors.mutedForeground + "80" : colors.foreground }]} selectable>
                      {editChannel.url}
                    </Text>
                  </View>

                  {/* New URL from browser */}
                  {prefillUrl && prefillUrl !== editChannel.url && (
                    <View style={[s.urlPreview, { backgroundColor: colors.card, borderColor: colors.primary + "60" }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <View style={[s.streamBadge, { backgroundColor: colors.primary + "20" }]}>
                          <Text style={[s.streamBadgeTxt, { color: colors.primary }]}>URL MỚI (từ trình duyệt)</Text>
                        </View>
                      </View>
                      <Text style={[s.urlReadonly, s.mono, { color: url === prefillUrl ? colors.primary : colors.foreground }]} selectable>
                        {prefillUrl}
                      </Text>
                      {url === prefillUrl && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
                          <Feather name="check-circle" size={13} color="#22c55e" />
                          <Text style={{ fontSize: 12, color: "#22c55e", fontFamily: "Inter_500Medium" }}>Đã chọn URL mới này</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Manual edit toggle */}
                  <TextInput
                    style={[s.urlInput, s.mono, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://..."
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    keyboardType="url"
                    multiline
                  />
                </View>
              ) : (
                /* New channel: simple URL input pre-filled from browser */
                <View style={[s.urlPreview, { backgroundColor: colors.card, borderColor: colors.primary + "60", marginBottom: 0 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <View style={[s.streamBadge, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={[s.streamBadgeTxt, { color: colors.primary }]}>STREAM URL</Text>
                    </View>
                  </View>
                  <TextInput
                    style={[s.urlInput, s.mono, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://..."
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    keyboardType="url"
                    multiline
                  />
                </View>
              )}

              {/* Name */}
              <View style={s.field}>
                <Text style={[s.label, { color: colors.foreground }]}>Tên kênh</Text>
                <TextInput
                  style={[s.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                  placeholder="VD: VTV1, HTV7..."
                  placeholderTextColor={colors.mutedForeground}
                  value={name}
                  onChangeText={setName}
                />
              </View>

              {/* Headers */}
              <Text style={[s.section, { color: colors.mutedForeground }]}>HEADERS (tuỳ chọn)</Text>

              {(["referer", "userAgent", "cookie", "authorization"] as const).map((key) => {
                const labels: Record<string, string> = { referer: "Referer", userAgent: "User-Agent", cookie: "Cookie", authorization: "Authorization" };
                const placeholders: Record<string, string> = {
                  referer: "https://trang-goc.vn/",
                  userAgent: "Mozilla/5.0 (iPhone...)",
                  cookie: "token=abc; session=xyz",
                  authorization: "Bearer eyJ...",
                };
                const on = toggles[key];
                return (
                  <View key={key} style={[s.headerRow, { backgroundColor: colors.card, borderColor: on ? colors.primary + "60" : colors.border }]}>
                    <TouchableOpacity style={s.headerToggle} onPress={() => setToggle(key, !on)} activeOpacity={0.75}>
                      <View style={[s.checkbox, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : "transparent" }]}>
                        {on && <Feather name="check" size={11} color={colors.primaryForeground} />}
                      </View>
                      <Text style={[s.headerLabel, { color: on ? colors.foreground : colors.mutedForeground }]}>{labels[key]}</Text>
                    </TouchableOpacity>
                    {on && (
                      <TextInput
                        style={[s.headerInput, s.mono, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                        placeholder={placeholders[key]}
                        placeholderTextColor={colors.mutedForeground}
                        value={headers[key]}
                        onChangeText={(v) => setHeader(key, v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    )}
                  </View>
                );
              })}

              {/* Preview */}
              {(toggles.referer || toggles.userAgent || toggles.cookie || toggles.authorization) && (
                <View style={[s.preview, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[s.previewLabel, { color: colors.mutedForeground }]}>URL SẼ LƯU</Text>
                  <Text style={[s.previewCode, s.mono, { color: colors.primary }]} numberOfLines={4}>
                    {url.trim()}
                    {[
                      toggles.referer && headers.referer ? `|Referer=${headers.referer}` : "",
                      toggles.userAgent && headers.userAgent ? `&User-Agent=${headers.userAgent}` : "",
                      toggles.cookie && headers.cookie ? `&Cookie=${headers.cookie}` : "",
                      toggles.authorization && headers.authorization ? `&Authorization=${headers.authorization}` : "",
                    ].filter(Boolean).join("").replace(/^\|/, "|").replace(/^&/, "|")}
                  </Text>
                </View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, width: 44 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 17, flex: 1, textAlign: "center" },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20 },
  saveTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15 },

  listContent: { padding: 12, gap: 10 },
  listItem: {
    flexDirection: "row", alignItems: "center", borderWidth: 1,
    borderRadius: 14, padding: 16, gap: 12,
  },
  listName: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  listMeta: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },

  newListBox: { borderWidth: 1, borderRadius: 14, padding: 14 },
  newListLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  newListInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 42, fontSize: 14 },
  createBtn: { paddingHorizontal: 18, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  createBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14 },

  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },

  newChannelBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1,
    borderRadius: 12, padding: 14, marginBottom: 4,
  },
  newChannelTxt: { fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1 },

  empty: { alignItems: "center", paddingTop: 40, gap: 12 },
  emptyTxt: { fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" },

  channelItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 12, padding: 14,
  },
  channelName: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  channelUrl: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11 },
  hBadge: { flexDirection: "row", borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  hBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 9 },

  editContent: { paddingHorizontal: 16, paddingTop: 16, gap: 4 },
  urlPreview: { borderWidth: 1.5, borderRadius: 14, padding: 14, marginBottom: 16, gap: 4 },
  streamBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  streamBadgeTxt: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.5 },
  urlInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, minHeight: 44 },

  field: { gap: 6, marginBottom: 12 },
  label: { fontFamily: "Inter_500Medium", fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, height: 46, fontSize: 14 },

  section: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1, marginTop: 8, marginBottom: 6 },

  headerRow: { borderWidth: 1, borderRadius: 12, overflow: "hidden", marginBottom: 8 },
  headerToggle: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  headerLabel: { fontFamily: "Inter_500Medium", fontSize: 14 },
  headerInput: { borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 0, paddingHorizontal: 14, paddingVertical: 10, fontSize: 12, margin: 0 },

  preview: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6, marginTop: 8 },
  previewLabel: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1 },
  previewCode: { fontSize: 11, lineHeight: 16 },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },

  changeBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  changeBtnTxt: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  urlReadonly: { fontSize: 12, lineHeight: 17 },
});
