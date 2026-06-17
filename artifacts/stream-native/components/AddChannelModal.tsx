import React, { useState, useEffect } from "react";
import {
  Modal, View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import {
  useCreateChannel, useUpdateChannel, useListChannels,
  getListChannelsQueryKey, Channel,
} from "@workspace/api-client-react";

interface Props {
  visible: boolean;
  onClose: () => void;
  prefillApiUrl?: string;
  prefillPageUrl?: string;
  prefillName?: string;
}

interface HeaderFields {
  userAgent: string;
  referer: string;
  cookie: string;
  authorization: string;
  custom: string;
}

function buildHeadersJson(h: HeaderFields): string {
  const obj: Record<string, string> = {};
  if (h.userAgent) obj["User-Agent"] = h.userAgent;
  if (h.referer) obj["Referer"] = h.referer;
  if (h.cookie) obj["Cookie"] = h.cookie;
  if (h.authorization) obj["Authorization"] = h.authorization;
  if (h.custom.trim()) {
    try {
      const extra = JSON.parse(h.custom);
      Object.assign(obj, extra);
    } catch { /* ignore invalid JSON */ }
  }
  return Object.keys(obj).length > 0 ? JSON.stringify(obj, null, 2) : "{}";
}

function parseHeadersToFields(json: string): HeaderFields {
  const empty: HeaderFields = { userAgent: "", referer: "", cookie: "", authorization: "", custom: "" };
  if (!json || json === "{}") return empty;
  try {
    const obj = JSON.parse(json) as Record<string, string>;
    const known = ["User-Agent", "Referer", "Cookie", "Authorization"];
    const remaining: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!known.includes(k)) remaining[k] = v;
    }
    return {
      userAgent: obj["User-Agent"] || "",
      referer: obj["Referer"] || "",
      cookie: obj["Cookie"] || "",
      authorization: obj["Authorization"] || "",
      custom: Object.keys(remaining).length > 0 ? JSON.stringify(remaining, null, 2) : "",
    };
  } catch {
    return { ...empty, custom: json };
  }
}

export function AddChannelModal({ visible, onClose, prefillApiUrl = "", prefillPageUrl = "", prefillName = "" }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: channels } = useListChannels();
  const createMutation = useCreateChannel();
  const updateMutation = useUpdateChannel();

  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderFields>({ userAgent: "", referer: "", cookie: "", authorization: "", custom: "" });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mode, setMode] = useState<"new" | "update">("new");
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [showChannelPicker, setShowChannelPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      setApiUrl(prefillApiUrl);
      setPageUrl(prefillPageUrl);
      setName(prefillName || guessName(prefillPageUrl || prefillApiUrl));
      setHeaders({ userAgent: "", referer: prefillPageUrl ? new URL(prefillPageUrl).origin + "/" : "", cookie: "", authorization: "", custom: "" });
      setMode("new");
      setSelectedChannelId(null);
      setShowAdvanced(false);
    }
  }, [visible, prefillApiUrl, prefillPageUrl, prefillName]);

  function guessName(url: string): string {
    if (!url) return "";
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "").split(".")[0];
    } catch {
      return "";
    }
  }

  const selectedChannel = channels?.find((c) => c.id === selectedChannelId) ?? null;

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("Thiếu tên", "Vui lòng nhập tên kênh"); return; }
    if (!apiUrl.trim() && !pageUrl.trim()) { Alert.alert("Thiếu URL", "Cần ít nhất API URL hoặc URL trang"); return; }

    const payload = {
      name: name.trim(),
      url: pageUrl.trim(),
      apiUrl: apiUrl.trim(),
      method: "GET" as const,
      headers: buildHeadersJson(headers),
      notes: "",
      loginUrl: "",
      loginBody: "{}",
      loginUsername: "",
      loginPassword: "",
      tokenPath: "",
      tokenType: "bearer" as const,
    };

    if (mode === "update" && selectedChannel) {
      updateMutation.mutate(
        { id: selectedChannel.id, data: { ...payload, method: (selectedChannel.method as "GET" | "POST") || "GET" } },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
            onClose();
          },
        },
      );
    } else {
      createMutation.mutate(
        { data: payload },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
            onClose();
          },
        },
      );
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[s.container, { backgroundColor: colors.background }]}>
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.title, { color: colors.foreground }]}>Thêm vào kênh</Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={isSaving}
            style={[s.saveBtn, { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 }]}
          >
            {isSaving
              ? <ActivityIndicator size="small" color={colors.primaryForeground} />
              : <Text style={[s.saveTxt, { color: colors.primaryForeground }]}>Lưu</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Mode tabs */}
        <View style={[s.modeRow, { borderBottomColor: colors.border }]}>
          {([["new", "Kênh mới"], ["update", "Cập nhật kênh"]] as const).map(([m, label]) => (
            <TouchableOpacity key={m} style={[s.modeBtn, { borderBottomColor: mode === m ? colors.primary : "transparent", borderBottomWidth: 2 }]} onPress={() => setMode(m)}>
              <Text style={[s.modeTxt, { color: mode === m ? colors.primary : colors.mutedForeground }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.form, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">

            {/* Update mode: channel picker */}
            {mode === "update" && (
              <View style={s.fieldGroup}>
                <Text style={[s.label, { color: colors.foreground }]}>Chọn kênh để cập nhật</Text>
                <TouchableOpacity
                  style={[s.picker, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => setShowChannelPicker((v) => !v)}
                >
                  <Text style={[s.pickerTxt, { color: selectedChannel ? colors.foreground : colors.mutedForeground }]}>
                    {selectedChannel ? selectedChannel.name : "— Chọn kênh —"}
                  </Text>
                  <Feather name={showChannelPicker ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
                {showChannelPicker && (
                  <View style={[s.dropdownList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    {(channels || []).map((ch: Channel) => (
                      <TouchableOpacity
                        key={ch.id}
                        style={[s.dropdownItem, { borderBottomColor: colors.border }]}
                        onPress={() => { setSelectedChannelId(ch.id); setShowChannelPicker(false); setName(ch.name); }}
                      >
                        <Text style={[s.dropdownTxt, { color: colors.foreground }]} numberOfLines={1}>{ch.name}</Text>
                        <Text style={[s.dropdownSub, { color: colors.mutedForeground }]} numberOfLines={1}>{ch.apiUrl || ch.url}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Name */}
            <View style={s.fieldGroup}>
              <Text style={[s.label, { color: colors.foreground }]}>Tên kênh *</Text>
              <TextInput
                style={[s.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="VD: VTV1, K+, FPT Play..."
                placeholderTextColor={colors.mutedForeground}
                value={name}
                onChangeText={setName}
              />
            </View>

            {/* API URL */}
            <View style={s.fieldGroup}>
              <Text style={[s.label, { color: colors.foreground }]}>API URL (stream)</Text>
              <Text style={[s.hint, { color: colors.mutedForeground }]}>Link stream bắt được từ trang</Text>
              <TextInput
                style={[s.input, s.mono, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="https://..."
                placeholderTextColor={colors.mutedForeground}
                value={apiUrl}
                onChangeText={setApiUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>

            {/* Page URL */}
            <View style={s.fieldGroup}>
              <Text style={[s.label, { color: colors.foreground }]}>URL trang web</Text>
              <Text style={[s.hint, { color: colors.mutedForeground }]}>Trang chứa player (để app tự fetch)</Text>
              <TextInput
                style={[s.input, s.mono, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="https://..."
                placeholderTextColor={colors.mutedForeground}
                value={pageUrl}
                onChangeText={setPageUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>

            {/* ── Headers section ── */}
            <Text style={[s.section, { color: colors.mutedForeground }]}>HEADERS / XÁC THỰC</Text>

            <View style={s.fieldGroup}>
              <Text style={[s.label, { color: colors.foreground }]}>Referer</Text>
              <TextInput
                style={[s.input, s.mono, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="https://trang-goc.vn/"
                placeholderTextColor={colors.mutedForeground}
                value={headers.referer}
                onChangeText={(v) => setHeaders((h) => ({ ...h, referer: v }))}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={[s.label, { color: colors.foreground }]}>Cookie</Text>
              <TextInput
                style={[s.input, s.mono, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="token=abc123; session=xyz"
                placeholderTextColor={colors.mutedForeground}
                value={headers.cookie}
                onChangeText={(v) => setHeaders((h) => ({ ...h, cookie: v }))}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={[s.label, { color: colors.foreground }]}>Authorization</Text>
              <TextInput
                style={[s.input, s.mono, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Bearer eyJ..."
                placeholderTextColor={colors.mutedForeground}
                value={headers.authorization}
                onChangeText={(v) => setHeaders((h) => ({ ...h, authorization: v }))}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={[s.label, { color: colors.foreground }]}>User-Agent</Text>
              <TextInput
                style={[s.input, s.mono, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Mozilla/5.0 ..."
                placeholderTextColor={colors.mutedForeground}
                value={headers.userAgent}
                onChangeText={(v) => setHeaders((h) => ({ ...h, userAgent: v }))}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Advanced: custom JSON headers */}
            <TouchableOpacity
              style={[s.advancedToggle, { borderColor: showAdvanced ? colors.primary : colors.border, backgroundColor: showAdvanced ? colors.primary + "10" : colors.card }]}
              onPress={() => setShowAdvanced((v) => !v)}
            >
              <Feather name="code" size={14} color={showAdvanced ? colors.primary : colors.mutedForeground} />
              <Text style={[s.advancedTxt, { color: showAdvanced ? colors.primary : colors.mutedForeground }]}>Headers tuỳ chỉnh (JSON)</Text>
              <Feather name={showAdvanced ? "chevron-up" : "chevron-down"} size={14} color={showAdvanced ? colors.primary : colors.mutedForeground} />
            </TouchableOpacity>

            {showAdvanced && (
              <View style={s.fieldGroup}>
                <Text style={[s.hint, { color: colors.mutedForeground }]}>Các header khác ở dạng JSON, sẽ được gộp với các trường trên</Text>
                <TextInput
                  style={[s.textArea, s.mono, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                  placeholder={'{\n  "X-Custom": "value"\n}'}
                  placeholderTextColor={colors.mutedForeground}
                  value={headers.custom}
                  onChangeText={(v) => setHeaders((h) => ({ ...h, custom: v }))}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}

            {/* Preview */}
            {(headers.referer || headers.cookie || headers.authorization || headers.userAgent || headers.custom) && (
              <View style={[s.preview, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[s.previewLabel, { color: colors.mutedForeground }]}>HEADERS SẼ GỬI</Text>
                <Text style={[s.previewCode, { color: colors.foreground }]}>
                  {buildHeadersJson(headers)}
                </Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
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
  closeBtn: { padding: 4, width: 44 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 17 },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20 },
  saveTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15 },

  modeRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  modeBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
  modeTxt: { fontFamily: "Inter_600SemiBold", fontSize: 13 },

  form: { paddingHorizontal: 16, paddingTop: 16, gap: 4 },
  section: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 1, marginTop: 16, marginBottom: 4 },
  fieldGroup: { gap: 4, marginBottom: 12 },
  label: { fontFamily: "Inter_500Medium", fontSize: 14 },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 16 },

  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, height: 46, fontSize: 13 },
  textArea: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    minHeight: 100, textAlignVertical: "top", fontSize: 12,
  },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },

  picker: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, height: 46 },
  pickerTxt: { fontFamily: "Inter_400Regular", fontSize: 14, flex: 1 },
  dropdownList: { borderWidth: 1, borderRadius: 10, marginTop: 4, overflow: "hidden" },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  dropdownTxt: { fontFamily: "Inter_500Medium", fontSize: 14 },
  dropdownSub: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11, marginTop: 2 },

  advancedToggle: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 12,
  },
  advancedTxt: { fontFamily: "Inter_500Medium", fontSize: 13, flex: 1 },

  preview: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6, marginBottom: 12 },
  previewLabel: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1 },
  previewCode: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11, lineHeight: 17 },
});
