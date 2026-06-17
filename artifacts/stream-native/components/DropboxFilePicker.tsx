import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  FlatList, TextInput, Modal, Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  dropboxListFolder, dropboxDownload, dropboxVerifyToken,
  saveDropboxToken, clearDropboxToken, getDropboxToken,
  formatFileSize, isM3UFile, DropboxEntry,
} from "@/hooks/useDropbox";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  onClose: () => void;
  onImport: (content: string, name: string, dropboxPath: string) => void;
}

type Screen = "token" | "browser";

export default function DropboxFilePicker({ visible, onClose, onImport }: Props) {
  const colors = useColors();
  const [screen, setScreen] = useState<Screen>("token");
  const [tokenInput, setTokenInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("/");
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const loadEntries = useCallback(async (tok: string, path: string) => {
    setLoading(true);
    try {
      const list = await dropboxListFolder(tok, path);
      setEntries(list);
    } catch (e: unknown) {
      Alert.alert("Lỗi Dropbox", e instanceof Error ? e.message : "Không tải được danh sách");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    getDropboxToken().then((tok) => {
      if (tok) {
        setToken(tok);
        setScreen("browser");
        setCurrentPath("/");
        setPathStack([]);
        loadEntries(tok, "/");
      } else {
        setScreen("token");
      }
    });
  }, [visible, loadEntries]);

  const handleVerify = async () => {
    if (!tokenInput.trim()) return;
    setVerifying(true);
    try {
      const name = await dropboxVerifyToken(tokenInput.trim());
      await saveDropboxToken(tokenInput.trim());
      setToken(tokenInput.trim());
      setAccountName(name);
      setScreen("browser");
      setCurrentPath("/");
      setPathStack([]);
      loadEntries(tokenInput.trim(), "/");
    } catch (e: unknown) {
      Alert.alert("Lỗi xác thực", e instanceof Error ? e.message : "Token không hợp lệ");
    } finally {
      setVerifying(false);
    }
  };

  const handleDisconnect = async () => {
    Alert.alert("Ngắt kết nối Dropbox?", "Token sẽ bị xoá khỏi app", [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Ngắt kết nối", style: "destructive", onPress: async () => {
          await clearDropboxToken();
          setToken(null);
          setTokenInput("");
          setScreen("token");
        },
      },
    ]);
  };

  const handleFolderOpen = (entry: DropboxEntry) => {
    setPathStack((prev) => [...prev, currentPath]);
    setCurrentPath(entry.path_display);
    loadEntries(token!, entry.path_lower);
  };

  const handleBack = () => {
    const prev = pathStack[pathStack.length - 1] ?? "/";
    setPathStack((s) => s.slice(0, -1));
    setCurrentPath(prev);
    loadEntries(token!, prev);
  };

  const handleFileSelect = async (entry: DropboxEntry) => {
    if (!token) return;
    setDownloading(entry.path_lower);
    try {
      const content = await dropboxDownload(token, entry.path_lower);
      onImport(content, entry.name.replace(/\.(m3u8?|txt)$/i, ""), entry.path_display);
    } catch (e: unknown) {
      Alert.alert("Lỗi tải file", e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setDownloading(null);
    }
  };

  const renderTokenScreen = () => (
    <View style={styles.centeredContent}>
      <View style={[styles.dropboxIcon, { backgroundColor: "#0061ff20" }]}>
        <Feather name="box" size={32} color="#0061ff" />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Kết nối Dropbox</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Tạo Dropbox app tại dropbox.com/developers → Settings → Generate access token (chọn "No expiration")
      </Text>

      <TextInput
        style={[styles.tokenInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
        placeholder="Dán access token tại đây..."
        placeholderTextColor={colors.mutedForeground}
        value={tokenInput}
        onChangeText={setTokenInput}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        numberOfLines={3}
      />

      <TouchableOpacity
        style={[styles.confirmBtn, { backgroundColor: "#0061ff", opacity: verifying || !tokenInput.trim() ? 0.6 : 1 }]}
        onPress={handleVerify}
        disabled={verifying || !tokenInput.trim()}
      >
        {verifying
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={styles.confirmTxt}>Xác nhận</Text>}
      </TouchableOpacity>
    </View>
  );

  const renderBrowserScreen = () => (
    <View style={{ flex: 1 }}>
      {/* Breadcrumb path */}
      <View style={[styles.pathBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {pathStack.length > 0 && (
          <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
            <Feather name="chevron-left" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
        <Text style={[styles.pathText, { color: colors.mutedForeground, flex: 1 }]} numberOfLines={1}>
          {currentPath === "/" ? "Dropbox" : currentPath.split("/").filter(Boolean).join(" / ")}
        </Text>
        <TouchableOpacity onPress={handleDisconnect} style={styles.backBtn}>
          <Feather name="log-out" size={16} color="#ef4444" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centeredContent}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[{ color: colors.mutedForeground, marginTop: 12, fontSize: 13 }]}>Đang tải...</Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.centeredContent}>
          <Feather name="folder" size={40} color={colors.mutedForeground} style={{ opacity: 0.4 }} />
          <Text style={[{ color: colors.mutedForeground, marginTop: 12, fontSize: 13 }]}>Thư mục trống</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.path_lower}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => {
            const isFolder = item[".tag"] === "folder";
            const isM3U = !isFolder && isM3UFile(item.name);
            const isLoading = downloading === item.path_lower;
            const dimmed = !isFolder && !isM3U;

            return (
              <TouchableOpacity
                style={[styles.entryRow, { borderBottomColor: colors.border, opacity: dimmed ? 0.4 : 1 }]}
                onPress={() => {
                  if (isFolder) handleFolderOpen(item);
                  else if (isM3U && !isLoading) handleFileSelect(item);
                }}
                disabled={dimmed || isLoading}
                activeOpacity={0.7}
              >
                <View style={[styles.entryIcon, { backgroundColor: isFolder ? colors.primary + "20" : isM3U ? "#22c55e20" : colors.card }]}>
                  {isLoading
                    ? <ActivityIndicator size="small" color="#22c55e" />
                    : <Feather
                        name={isFolder ? "folder" : "file-text"}
                        size={18}
                        color={isFolder ? colors.primary : isM3U ? "#22c55e" : colors.mutedForeground}
                      />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.entryName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                  {!isFolder && item.size != null && (
                    <Text style={[styles.entryMeta, { color: colors.mutedForeground }]}>{formatFileSize(item.size)}</Text>
                  )}
                </View>
                {isFolder && <Feather name="chevron-right" size={16} color={colors.mutedForeground} />}
                {isM3U && !isLoading && <Feather name="download" size={16} color="#22c55e" />}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="box" size={18} color="#0061ff" />
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Dropbox</Text>
            {accountName && (
              <Text style={[styles.accountName, { color: colors.mutedForeground }]}>· {accountName}</Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {screen === "token" ? renderTokenScreen() : renderBrowserScreen()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  accountName: { fontFamily: "Inter_400Regular", fontSize: 13 },
  closeBtn: { padding: 4 },

  centeredContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 14 },
  dropboxIcon: { width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center" },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center", lineHeight: 20 },
  tokenInput: {
    width: "100%", borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 12, fontFamily: "Inter_400Regular", minHeight: 80, textAlignVertical: "top",
  },
  confirmBtn: {
    width: "100%", height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center",
  },
  confirmTxt: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: "#fff" },

  pathBar: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 4,
  },
  backBtn: { padding: 6 },
  pathText: { fontFamily: "Inter_400Regular", fontSize: 13 },

  entryRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entryIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  entryName: { fontFamily: "Inter_500Medium", fontSize: 14 },
  entryMeta: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 },
});
