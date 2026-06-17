import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import Animated, { FadeInUp, FadeOutDown } from "react-native-reanimated";

import { useColors } from "@/hooks/useColors";
import { StreamLink } from "@workspace/api-client-react";

function getBadgeColor(type: string) {
  const lower = type.toLowerCase();
  if (lower.includes("m3u8") || lower.includes("hls")) return "#00d4ff";
  if (lower.includes("mp4")) return "#10b981";
  if (lower.includes("webm")) return "#a855f7";
  if (lower.includes("dash") || lower.includes("mpd")) return "#f59e0b";
  return "#6b7280";
}

export function StreamLinkCard({ item, index }: { item: StreamLink, index: number }) {
  const colors = useColors();
  const badgeColor = getBadgeColor(item.type);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(item.url);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleOpen = async () => {
    await WebBrowser.openBrowserAsync(item.url);
  };

  return (
    <Animated.View entering={FadeInUp.delay(index * 100)} exiting={FadeOutDown} style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.badgeContainer}>
          <View style={[styles.badge, { backgroundColor: `${badgeColor}20`, borderColor: badgeColor }]}>
            <Text style={[styles.badgeText, { color: badgeColor }]}>{item.type.toUpperCase()}</Text>
          </View>
          {item.quality && (
            <View style={[styles.qualityBadge, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.qualityText, { color: colors.mutedForeground }]}>{item.quality}</Text>
            </View>
          )}
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity onPress={handleCopy} style={styles.iconButton}>
            <Feather name="copy" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleOpen} style={styles.iconButton}>
            <Feather name="external-link" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>
      
      <Text style={[styles.urlText, { color: colors.foreground }]} numberOfLines={1} ellipsizeMode="middle">
        {item.url}
      </Text>
      
      {item.label && (
        <Text style={[styles.labelText, { color: colors.mutedForeground }]}>{item.label}</Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  resultCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badgeContainer: {
    flexDirection: "row",
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
  },
  qualityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  qualityText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
  },
  actionRow: {
    flexDirection: "row",
    gap: 16,
  },
  iconButton: {
    padding: 4,
  },
  urlText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
  },
  labelText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  }
});