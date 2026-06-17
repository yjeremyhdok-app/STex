import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Platform, Keyboard, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useExtractStreams } from "@workspace/api-client-react";
import { StreamLinkCard } from "@/components/StreamLinkCard";

export default function ExtractScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ extractUrl?: string }>();
  
  const [url, setUrl] = useState("");
  
  const extractMutation = useExtractStreams();

  useEffect(() => {
    if (params.extractUrl) {
      setUrl(params.extractUrl);
      extractMutation.mutate({ data: { url: params.extractUrl } });
      router.setParams({ extractUrl: "" });
    }
  }, [params.extractUrl]);

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setUrl(text);
      Haptics.selectionAsync();
    }
  };

  const handleExtract = () => {
    if (!url.trim()) return;
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    extractMutation.mutate({ data: { url: url.trim() } });
  };

  const handleClear = () => {
    setUrl("");
    extractMutation.reset();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Stream Extractor</Text>
        <TouchableOpacity onPress={() => router.push("/history")} style={styles.historyButton}>
          <Feather name="clock" size={24} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <View style={styles.inputSection}>
        <View style={[styles.inputContainer, { backgroundColor: colors.input, borderColor: colors.border }]}>
          <Feather name="link" size={20} color={colors.mutedForeground} style={styles.inputIcon} />
          <TextInput
            style={[styles.input, { color: colors.foreground }]}
            placeholder="Paste video URL here..."
            placeholderTextColor={colors.mutedForeground}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardAppearance="dark"
            returnKeyType="go"
            onSubmitEditing={handleExtract}
          />
          {url.length > 0 ? (
            <TouchableOpacity onPress={handleClear} style={styles.pasteButton}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handlePaste} style={styles.pasteButton}>
              <Feather name="clipboard" size={18} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity 
          style={[styles.extractButton, { backgroundColor: colors.primary }, (!url.trim() || extractMutation.isPending) && { opacity: 0.5 }]}
          onPress={handleExtract}
          disabled={!url.trim() || extractMutation.isPending}
        >
          {extractMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="zap" size={18} color={colors.primaryForeground} />
              <Text style={[styles.extractButtonText, { color: colors.primaryForeground }]}>Extract Streams</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {extractMutation.isError && (
        <View style={[styles.errorContainer, { backgroundColor: `${colors.destructive}20`, borderColor: colors.destructive }]}>
          <Feather name="alert-triangle" size={20} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            {extractMutation.error?.data?.error || "Failed to extract streams"}
          </Text>
        </View>
      )}

      <FlatList
        data={extractMutation.data?.links || []}
        keyExtractor={(item, index) => `${item.url}-${index}`}
        renderItem={({ item, index }) => <StreamLinkCard item={item} index={index} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={extractMutation.isPending}
            onRefresh={handleExtract}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          !extractMutation.isPending && !extractMutation.isError && extractMutation.data ? (
            <View style={styles.emptyState}>
              <Feather name="video-off" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No streams found on this page</Text>
            </View>
          ) : !extractMutation.data && !extractMutation.isPending && !extractMutation.isError ? (
            <View style={styles.emptyState}>
              <Feather name="terminal" size={48} color={colors.mutedForeground} style={{ opacity: 0.5 }} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Ready to extract</Text>
            </View>
          ) : null
        }
        ListHeaderComponent={
          extractMutation.data ? (
            <View style={styles.resultsHeader}>
              <Text style={[styles.resultsTitle, { color: colors.foreground }]}>{extractMutation.data.pageTitle}</Text>
              <Text style={[styles.resultsMeta, { color: colors.mutedForeground }]}>Found {extractMutation.data.links.length} streams</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 20 },
  headerTitle: { fontFamily: "Inter_700Bold", fontSize: 24, letterSpacing: -0.5 },
  historyButton: { padding: 8, marginRight: -8 },
  inputSection: { paddingHorizontal: 20, gap: 12, marginBottom: 20 },
  inputContainer: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 52 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, height: "100%" },
  pasteButton: { padding: 8, marginLeft: 4 },
  extractButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 52, borderRadius: 12, gap: 8 },
  extractButtonText: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  errorContainer: { flexDirection: "row", alignItems: "center", marginHorizontal: 20, padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 20, gap: 12 },
  errorText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14 },
  listContent: { paddingHorizontal: 20, flexGrow: 1 },
  resultsHeader: { marginBottom: 16 },
  resultsTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, marginBottom: 4 },
  resultsMeta: { fontFamily: "Inter_400Regular", fontSize: 14 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 16 },
  emptyText: { fontFamily: "Inter_500Medium", fontSize: 16 }
});