import React, { useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Modal, TextInput, Platform, ScrollView, KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import {
  useListChannels, useCreateChannel, useUpdateChannel,
  useDeleteChannel, useExtractChannel, getListChannelsQueryKey, Channel,
} from "@workspace/api-client-react";

type Method = "GET" | "POST";
type TokenType = "bearer" | "cookie" | "query";

interface FormData {
  name: string;
  url: string;
  apiUrl: string;
  method: Method;
  headers: string;
  notes: string;
  // auto-login
  loginUrl: string;
  loginBody: string;
  loginUsername: string;
  loginPassword: string;
  tokenPath: string;
  tokenType: TokenType;
}

const EMPTY_FORM: FormData = {
  name: "", url: "", apiUrl: "", method: "GET", headers: "", notes: "",
  loginUrl: "", loginBody: "", loginUsername: "", loginPassword: "", tokenPath: "", tokenType: "bearer",
};

export default function ChannelsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: channels, isLoading, refetch, isRefetching } = useListChannels();
  const createMutation = useCreateChannel();
  const updateMutation = useUpdateChannel();
  const deleteMutation = useDeleteChannel();
  const extractMutation = useExtractChannel();

  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [showLogin, setShowLogin] = useState(false);

  const setField = (key: keyof FormData, val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleExtract = (channel: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setExtractingId(channel.id);
    extractMutation.mutate(
      { id: channel.id },
      {
        onSuccess: (data) => {
          setExtractingId(null);
          router.push({ pathname: "/results", params: { data: JSON.stringify(data) } });
        },
        onError: (err) => {
          setExtractingId(null);
          Alert.alert("Lỗi", err.data?.error || "Không lấy được link stream");
        },
      },
    );
  };

  const handleLongPress = (channel: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(channel.name, undefined, [
      { text: "Sửa", onPress: () => openModal(channel) },
      { text: "Xoá", style: "destructive", onPress: () => confirmDelete(channel) },
      { text: "Huỷ", style: "cancel" },
    ]);
  };

  const confirmDelete = (channel: Channel) => {
    Alert.alert("Xoá kênh", `Xoá "${channel.name}"?`, [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Xoá",
        style: "destructive",
        onPress: () =>
          deleteMutation.mutate(
            { id: channel.id },
            { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() }) },
          ),
      },
    ]);
  };

  const openModal = (channel?: Channel) => {
    if (channel) {
      setEditingChannel(channel);
      setForm({
        name: channel.name,
        url: channel.url || "",
        apiUrl: channel.apiUrl || "",
        method: (channel.method as Method) || "GET",
        headers: channel.headers || "",
        notes: channel.notes || "",
        loginUrl: channel.loginUrl || "",
        loginBody: channel.loginBody || "",
        loginUsername: channel.loginUsername || "",
        loginPassword: channel.loginPassword || "",
        tokenPath: channel.tokenPath || "",
        tokenType: (channel.tokenType as TokenType) || "bearer",
      });
      setShowLogin(!!(channel.loginUrl || channel.loginUsername));
    } else {
      setEditingChannel(null);
      setForm(EMPTY_FORM);
      setShowLogin(false);
    }
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditingChannel(null);
    setForm(EMPTY_FORM);
    setShowLogin(false);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      Alert.alert("Thiếu thông tin", "Tên kênh là bắt buộc");
      return;
    }
    if (!form.url.trim() && !form.apiUrl.trim()) {
      Alert.alert("Thiếu thông tin", "Cần ít nhất URL trang hoặc API URL");
      return;
    }

    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      apiUrl: form.apiUrl.trim(),
      method: form.method,
      headers: form.headers.trim() || "{}",
      notes: form.notes.trim(),
      loginUrl: form.loginUrl.trim(),
      loginBody: form.loginBody.trim() || "{}",
      loginUsername: form.loginUsername.trim(),
      loginPassword: form.loginPassword,
      tokenPath: form.tokenPath.trim(),
      tokenType: form.tokenType,
    };

    if (editingChannel) {
      updateMutation.mutate(
        { id: editingChannel.id, data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
            closeModal();
          },
        },
      );
    } else {
      createMutation.mutate(
        { data: payload },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
            closeModal();
          },
        },
      );
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const hasLogin = (ch: Channel) => !!(ch.loginUrl && ch.loginUsername);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Kênh</Text>
      </View>

      {isLoading && !isRefetching ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={channels || []}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          refreshing={isRefetching}
          onRefresh={refetch}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="list" size={48} color={colors.mutedForeground} style={{ opacity: 0.4 }} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Chưa có kênh nào
              </Text>
              <Text style={[styles.emptySubText, { color: colors.mutedForeground }]}>
                Nhấn + để thêm kênh
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => handleExtract(item)}
              onLongPress={() => handleLongPress(item)}
              delayLongPress={400}
              activeOpacity={0.75}
            >
              <View style={styles.cardInfo}>
                <View style={styles.cardTitleRow}>
                  <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {hasLogin(item) && (
                    <View style={[styles.loginBadge, { backgroundColor: "#10b98120", borderColor: "#10b981" }]}>
                      <Feather name="lock" size={10} color="#10b981" />
                      <Text style={[styles.loginBadgeText, { color: "#10b981" }]}>AUTO</Text>
                    </View>
                  )}
                </View>
                {!!item.apiUrl && (
                  <View style={styles.apiRow}>
                    <View style={[styles.methodBadge, { backgroundColor: colors.primary + "25" }]}>
                      <Text style={[styles.methodText, { color: colors.primary }]}>{item.method || "GET"}</Text>
                    </View>
                    <Text style={[styles.cardUrl, { color: colors.primary }]} numberOfLines={1}>
                      {item.apiUrl}
                    </Text>
                  </View>
                )}
                {!!item.url && !item.apiUrl && (
                  <Text style={[styles.cardUrl, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.url}
                  </Text>
                )}
                {!!item.url && !!item.apiUrl && (
                  <Text style={[styles.cardUrl, { color: colors.mutedForeground }]} numberOfLines={1}>
                    Trang: {item.url}
                  </Text>
                )}
                {!!item.notes && (
                  <Text style={[styles.cardNotes, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.notes}
                  </Text>
                )}
              </View>

              <View style={[styles.playBtn, { backgroundColor: colors.primary + "20" }]}>
                {extractingId === item.id ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Feather name="play" size={20} color={colors.primary} />
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary, bottom: insets.bottom + 80 }]}
        onPress={() => openModal()}
      >
        <Feather name="plus" size={24} color={colors.primaryForeground} />
      </TouchableOpacity>

      {/* Add / Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={closeModal}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={closeModal} style={styles.modalClose}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {editingChannel ? "Sửa kênh" : "Thêm kênh"}
            </Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving}
              style={[styles.modalSaveBtn, { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 }]}
            >
              {isSaving ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Text style={[styles.modalSaveText, { color: colors.primaryForeground }]}>Lưu</Text>
              )}
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 40 }]}
              keyboardShouldPersistTaps="handled"
            >
              {/* Name */}
              <Field label="Tên kênh *" colors={colors}>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                  placeholder="VD: VTV1, FPT Play - Phim..."
                  placeholderTextColor={colors.mutedForeground}
                  value={form.name}
                  onChangeText={(t) => setField("name", t)}
                />
              </Field>

              <SectionLabel label="NGUỒN STREAM" colors={colors} />

              {/* API URL */}
              <Field
                label="API URL"
                hint="Endpoint API trực tiếp trả về link stream (ưu tiên hơn URL trang)"
                colors={colors}
              >
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }]}
                  placeholder="https://api.kenh.vn/stream/..."
                  placeholderTextColor={colors.mutedForeground}
                  value={form.apiUrl}
                  onChangeText={(t) => setField("apiUrl", t)}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </Field>

              {/* Method toggle */}
              {!!form.apiUrl && (
                <Field label="Method" colors={colors}>
                  <View style={styles.toggleRow}>
                    {(["GET", "POST"] as Method[]).map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[
                          styles.toggleOption,
                          { borderColor: colors.border, backgroundColor: colors.card },
                          form.method === m && { backgroundColor: colors.primary, borderColor: colors.primary },
                        ]}
                        onPress={() => setField("method", m)}
                      >
                        <Text style={[styles.toggleOptionText, { color: form.method === m ? colors.primaryForeground : colors.foreground }]}>
                          {m}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </Field>
              )}

              {/* Page URL */}
              <Field
                label="URL trang"
                hint="URL trang web có player (dùng yt-dlp nếu không có API URL)"
                colors={colors}
              >
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }]}
                  placeholder="https://vtv.vn/truyen-hinh-truc-tuyen.htm"
                  placeholderTextColor={colors.mutedForeground}
                  value={form.url}
                  onChangeText={(t) => setField("url", t)}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </Field>

              <SectionLabel label="TUỲ CHỈNH REQUEST" colors={colors} />

              {/* Headers */}
              <Field
                label="Headers"
                hint='JSON — thêm Referer, Cookie,... VD: {"Referer":"https://...","Cookie":"token=abc"}'
                colors={colors}
              >
                <TextInput
                  style={[styles.textArea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }]}
                  placeholder={'{\n  "Referer": "https://...",\n  "Authorization": "Bearer ..."\n}'}
                  placeholderTextColor={colors.mutedForeground}
                  value={form.headers}
                  onChangeText={(t) => setField("headers", t)}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>

              {/* ─── AUTO-LOGIN SECTION ─── */}
              <TouchableOpacity
                style={[styles.loginToggle, { borderColor: showLogin ? "#10b981" : colors.border, backgroundColor: showLogin ? "#10b98115" : colors.card }]}
                onPress={() => setShowLogin((v) => !v)}
                activeOpacity={0.8}
              >
                <View style={styles.loginToggleLeft}>
                  <Feather name="lock" size={16} color={showLogin ? "#10b981" : colors.mutedForeground} />
                  <Text style={[styles.loginToggleText, { color: showLogin ? "#10b981" : colors.mutedForeground }]}>
                    Đăng nhập tự động
                  </Text>
                  <View style={[styles.betaBadge, { backgroundColor: colors.secondary }]}>
                    <Text style={[styles.betaText, { color: colors.mutedForeground }]}>Beta</Text>
                  </View>
                </View>
                <Feather name={showLogin ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
              </TouchableOpacity>

              {showLogin && (
                <View style={[styles.loginSection, { borderColor: "#10b98140", backgroundColor: "#10b98108" }]}>
                  <Field
                    label="Login URL"
                    hint="Endpoint POST để đăng nhập (VD: https://api.fptplay.net/login)"
                    colors={colors}
                  >
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }]}
                      placeholder="https://api.kenh.vn/auth/login"
                      placeholderTextColor={colors.mutedForeground}
                      value={form.loginUrl}
                      onChangeText={(t) => setField("loginUrl", t)}
                      autoCapitalize="none"
                      keyboardType="url"
                    />
                  </Field>

                  <Field label="Tên đăng nhập / Email" colors={colors}>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                      placeholder="user@email.com"
                      placeholderTextColor={colors.mutedForeground}
                      value={form.loginUsername}
                      onChangeText={(t) => setField("loginUsername", t)}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                  </Field>

                  <Field label="Mật khẩu" colors={colors}>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                      placeholder="••••••••"
                      placeholderTextColor={colors.mutedForeground}
                      value={form.loginPassword}
                      onChangeText={(t) => setField("loginPassword", t)}
                      secureTextEntry
                    />
                  </Field>

                  <Field
                    label="Login Body (JSON)"
                    hint='Template body gửi khi login. Dùng {username} và {password} làm placeholder. Để trống = dùng mặc định {"username":..., "password":...}'
                    colors={colors}
                  >
                    <TextInput
                      style={[styles.textArea, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", minHeight: 80 }]}
                      placeholder={'{\n  "username": "{username}",\n  "password": "{password}"\n}'}
                      placeholderTextColor={colors.mutedForeground}
                      value={form.loginBody}
                      onChangeText={(t) => setField("loginBody", t)}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </Field>

                  <Field
                    label="Đường dẫn token"
                    hint='Vị trí token trong response JSON. VD: data.token hoặc access_token hoặc result.jwt'
                    colors={colors}
                  >
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }]}
                      placeholder="data.token"
                      placeholderTextColor={colors.mutedForeground}
                      value={form.tokenPath}
                      onChangeText={(t) => setField("tokenPath", t)}
                      autoCapitalize="none"
                    />
                  </Field>

                  <Field label="Loại token" hint="Cách đính kèm token vào request lấy stream" colors={colors}>
                    <View style={styles.toggleRow}>
                      {([
                        { val: "bearer", label: "Bearer" },
                        { val: "cookie", label: "Cookie" },
                        { val: "query", label: "Query" },
                      ] as { val: TokenType; label: string }[]).map(({ val, label }) => (
                        <TouchableOpacity
                          key={val}
                          style={[
                            styles.toggleOption,
                            { borderColor: colors.border, backgroundColor: colors.card },
                            form.tokenType === val && { backgroundColor: "#10b981", borderColor: "#10b981" },
                          ]}
                          onPress={() => setField("tokenType", val)}
                        >
                          <Text style={[styles.toggleOptionText, { color: form.tokenType === val ? "#fff" : colors.foreground }]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </Field>
                </View>
              )}

              {/* Notes */}
              <SectionLabel label="KHÁC" colors={colors} />
              <Field label="Ghi chú" colors={colors}>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, color: colors.foreground, borderColor: colors.border }]}
                  placeholder="Mô tả ngắn về kênh..."
                  placeholderTextColor={colors.mutedForeground}
                  value={form.notes}
                  onChangeText={(t) => setField("notes", t)}
                />
              </Field>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function Field({
  label,
  hint,
  children,
  colors,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
      {hint ? <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function SectionLabel({ label, colors }: { label: string; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.5 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 16, flexGrow: 1, gap: 10 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyText: { fontFamily: "Inter_500Medium", fontSize: 18 },
  emptySubText: { fontFamily: "Inter_400Regular", fontSize: 14, opacity: 0.7 },

  card: {
    flexDirection: "row", padding: 16, borderRadius: 14,
    borderWidth: 1, alignItems: "center", gap: 12,
  },
  cardInfo: { flex: 1, gap: 5 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { fontFamily: "Inter_600SemiBold", fontSize: 17, flex: 1 },
  loginBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, borderWidth: 1,
  },
  loginBadgeText: { fontFamily: "Inter_700Bold", fontSize: 9 },
  apiRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  methodBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  methodText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  cardUrl: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12, flex: 1,
  },
  cardNotes: { fontFamily: "Inter_400Regular", fontSize: 13 },
  playBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },

  fab: {
    position: "absolute", right: 20, width: 56, height: 56,
    borderRadius: 28, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },

  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalClose: { padding: 4, width: 44 },
  modalTitle: { fontFamily: "Inter_600SemiBold", fontSize: 17 },
  modalSaveBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20 },
  modalSaveText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },

  formContent: { paddingHorizontal: 16, paddingTop: 16, gap: 4 },

  sectionLabel: {
    fontFamily: "Inter_700Bold", fontSize: 11,
    letterSpacing: 1, marginTop: 16, marginBottom: 4, paddingHorizontal: 2,
  },
  fieldGroup: { gap: 4, marginBottom: 12 },
  fieldLabel: { fontFamily: "Inter_500Medium", fontSize: 14 },
  fieldHint: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 16 },
  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, height: 46, fontSize: 14,
  },
  textArea: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    minHeight: 110, textAlignVertical: "top", fontSize: 13,
  },
  toggleRow: { flexDirection: "row", gap: 10 },
  toggleOption: {
    flex: 1, height: 42, borderRadius: 10,
    borderWidth: 1, alignItems: "center", justifyContent: "center",
  },
  toggleOptionText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },

  // Login section
  loginToggle: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 14, borderRadius: 12, borderWidth: 1,
    marginTop: 8, marginBottom: 4,
  },
  loginToggleLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  loginToggleText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  betaBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  betaText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  loginSection: {
    borderWidth: 1, borderRadius: 14,
    padding: 14, marginBottom: 8, gap: 0,
  },
});
