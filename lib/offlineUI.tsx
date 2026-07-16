import FontAwesome from "@expo/vector-icons/FontAwesome";
import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { color, radius } from "./nimbus/tokens";
import { useOffline } from "./offline";
import { useTheme } from "./theme";
import { haptic } from "./ui";

// ============================================================
// OFFLINE BANNER — sits at top of every screen
// ============================================================
export function OfflineBanner() {
  const { isOnline, pendingCount, syncing } = useOffline();
  const T = useTheme();

  if (isOnline && pendingCount === 0) return null;

  return (
    <View
      style={[
        ob.wrap,
        {
          backgroundColor: isOnline ? T.warningDim : T.dangerDim,
          borderLeftColor: isOnline ? T.warning : T.danger,
        },
      ]}
    >
      <FontAwesome
        name={isOnline ? "refresh" : "wifi"}
        size={12}
        color={isOnline ? T.warning : T.danger}
        style={{ marginRight: 8 }}
      />
      <Text style={[ob.text, { color: isOnline ? T.warning : T.danger }]}>
        {!isOnline
          ? `Offline — ${pendingCount} pending`
          : syncing
          ? "Syncing..."
          : `${pendingCount} pending changes`}
      </Text>
      {pendingCount > 0 && (
        <View
          style={[
            ob.badge,
            { backgroundColor: isOnline ? T.warning : T.danger },
          ]}
        >
          <Text style={ob.badgeText}>{pendingCount}</Text>
        </View>
      )}
    </View>
  );
}

const ob = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    borderLeftWidth: 4, // semantic left-edge escalation, per list-row pattern
  },
  text: { fontSize: 12, fontWeight: "600", flex: 1 },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: "bold", color: color.white },
});

// ============================================================
// CONFLICT MODAL — shows when sync finds conflicts
// ============================================================
export function ConflictModal() {
  const { conflicts, resolveConflict, dismissConflict } = useOffline();
  const T = useTheme();

  if (conflicts.length === 0) return null;

  const conflict = conflicts[0]; // Show one at a time

  return (
    <Modal visible transparent animationType="fade">
      <View style={cm.overlay}>
        <View style={[cm.card, { backgroundColor: T.surface }]}>
          <View style={cm.iconWrap}>
            <View
              style={[cm.iconCircle, { backgroundColor: T.warning + "15" }]}
            >
              <FontAwesome
                name="exclamation-triangle"
                size={20}
                color={T.warning}
              />
            </View>
          </View>

          <Text style={[cm.title, { color: T.textPrimary }]}>
            Sync conflict
          </Text>
          <Text style={[cm.desc, { color: T.textSecondary }]}>
            {conflict.reason}
          </Text>

          <View style={[cm.detail, { backgroundColor: T.surface3 }]}>
            <Text style={[cm.detailLabel, { color: T.textSecondary }]}>
              Operation: {conflict.op.type}
            </Text>
            <Text style={[cm.detailLabel, { color: T.textSecondary }]}>
              Queued: {new Date(conflict.op.createdAt).toLocaleString()}
            </Text>
          </View>

          <View style={cm.actions}>
            <TouchableOpacity
              style={[
                cm.btn,
                {
                  backgroundColor: T.background,
                  borderColor: T.border,
                  borderWidth: 1,
                },
              ]}
              onPress={() => {
                haptic.medium();
                resolveConflict(conflict.op.id, false);
              }}
              activeOpacity={0.7}
            >
              <FontAwesome
                name="cloud-download"
                size={13}
                color={T.textSecondary}
                style={{ marginRight: 6 }}
              />
              <Text style={[cm.btnText, { color: T.textPrimary }]}>
                Keep server
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[cm.btn, { backgroundColor: T.accent }]}
              onPress={() => {
                haptic.medium();
                resolveConflict(conflict.op.id, true);
              }}
              activeOpacity={0.7}
            >
              <FontAwesome
                name="mobile"
                size={15}
                color={color.black}
                style={{ marginRight: 6 }}
              />
              <Text style={[cm.btnText, { color: color.black }]}>
                Keep mine
              </Text>
            </TouchableOpacity>
          </View>

          {conflicts.length > 1 && (
            <Text style={[cm.remaining, { color: T.textSecondary }]}>
              +{conflicts.length - 1} more conflict
              {conflicts.length > 2 ? "s" : ""}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const cm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: color.blackAlpha.a6, // modal backdrop parity with desktop
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  card: {
    width: "100%",
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: color.whiteAlpha.a2,
  },
  iconWrap: { marginBottom: 16 },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: radius.pill, // pill exception: status/avatar circles stay round
    justifyContent: "center",
    alignItems: "center",
  },
  title: { fontSize: 18, fontWeight: "bold", marginBottom: 8 },
  desc: { fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  detail: {
    width: "100%",
    padding: 12,
    marginBottom: 20,
  },
  detailLabel: { fontSize: 12, marginBottom: 4 },
  actions: { flexDirection: "row", gap: 10, width: "100%" },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  btnText: { fontSize: 14, fontWeight: "600" },
  remaining: { fontSize: 12, marginTop: 12 },
});

// ============================================================
// PENDING BADGE — for tab bar
// ============================================================
export function PendingBadge({ style }: { style?: any }) {
  const { pendingCount, isOnline } = useOffline();

  if (pendingCount === 0) return null;

  return (
    <View
      style={[
        pb.wrap,
        { backgroundColor: isOnline ? color.accent : color.danger },
        style,
      ]}
    >
      <Text style={[pb.text, { color: isOnline ? color.black : color.white }]}>
        {pendingCount > 9 ? "9+" : pendingCount}
      </Text>
    </View>
  );
}

const pb = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: radius.none, // sharp by default — count badge, not a status dot
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: color.nearBlack, // sits on the near-black tab bar
  },
  text: { fontSize: 9, fontWeight: "bold" },
});
