import React from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { StreamLinkCard } from "@/components/StreamLinkCard";
import { ExtractResult } from "@workspace/api-client-react";

export default function ResultsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ data?: string }>();
  
  let result: ExtractResult | null = null;
  try {
    if (params.data) {
      result = JSON.parse(params.data);
    }
  } catch (e) {
    console.error("Failed to parse result data", e);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Results</Text>
        <View style={{ width: 40 }} />
      </View>

      {!result || result.error ? (
        <View style={styles.errorContainer}>
          <Feather name="alert-circle" size={48} color={colors.destructive} style={{ marginBottom: 16 }} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            {result?.error || "Failed to load results"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={result.links || []}
          keyExtractor={(item, index) => `${item.url}-${index}`}
          renderItem={({ item, index }) => <StreamLinkCard item={item} index={index} />}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              <Text style={[styles.resultsTitle, { color: colors.foreground }]}>{result.pageTitle}</Text>
              <Text style={[styles.resultsMeta, { color: colors.mutedForeground }]}>{result.sourceUrl}</Text>
              <Text style={[styles.resultsCount, { color: colors.primary }]}>{result.links.length} streams found</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="video-off" size={48} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No streams found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 20 },
  backButton: { padding: 8 },
  headerTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18 },
  errorContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  errorText: { fontFamily: "Inter_500Medium", fontSize: 16, textAlign: "center" },
  listContent: { paddingHorizontal: 20, flexGrow: 1 },
  resultsHeader: { marginBottom: 20, gap: 4 },
  resultsTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  resultsMeta: { fontFamily: "Inter_400Regular", fontSize: 14 },
  resultsCount: { fontFamily: "Inter_600SemiBold", fontSize: 14, marginTop: 4 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 16 },
  emptyText: { fontFamily: "Inter_500Medium", fontSize: 16 }
});