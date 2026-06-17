import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useGetHistory, HistoryEntry } from "@workspace/api-client-react";

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const { data: history, isLoading, isError, refetch } = useGetHistory();

  const handleReExtract = (url: string) => {
    router.navigate({ pathname: "/", params: { extractUrl: url } });
  };

  const renderItem = ({ item }: { item: HistoryEntry }) => (
    <TouchableOpacity 
      style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => handleReExtract(item.sourceUrl)}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.pageTitle, { color: colors.foreground }]} numberOfLines={1}>{item.pageTitle}</Text>
        <View style={[styles.countBadge, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.countText, { color: colors.foreground }]}>{item.linkCount}</Text>
        </View>
      </View>
      <Text style={[styles.urlText, { color: colors.mutedForeground }]} numberOfLines={1}>{item.sourceUrl}</Text>
      <View style={styles.cardFooter}>
        <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
          {new Date(item.extractedAt).toLocaleDateString()} {new Date(item.extractedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>History</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.centerContainer}>
          <Feather name="alert-circle" size={48} color={colors.destructive} style={{ marginBottom: 16 }} />
          <Text style={[styles.errorText, { color: colors.destructive }]}>Failed to load history</Text>
          <TouchableOpacity style={[styles.retryButton, { backgroundColor: colors.primary }]} onPress={() => refetch()}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={history || []}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="clock" size={48} color={colors.mutedForeground} style={{ opacity: 0.5 }} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No extraction history yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  errorText: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
    marginBottom: 20,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 16,
  },
  emptyText: {
    fontFamily: "Inter_500Medium",
    fontSize: 16,
  },
  historyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pageTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    flex: 1,
    marginRight: 12,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
  },
  countText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  urlText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  dateText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  }
});