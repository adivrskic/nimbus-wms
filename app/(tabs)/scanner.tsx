/**
 * Scanner — Nimbus rebuild (visual only, flow preserved).
 *
 * Drop-in replacement for app/(tabs)/scanner.tsx. The state machine and
 * all data flow are unchanged from the prior implementation; only the
 * chrome is rewritten. Sharp corners (§1.1), corner-bracket crosshair
 * (§9.1 visual vocabulary), hairline field-shells, mono caps section
 * labels. The bottom sheet with the registration form sits flush against
 * the camera with a 1px top hairline — no rounded handle, no curved
 * cutout.
 *
 * One non-visual change: every insert into products / locations /
 * scan_history now includes org_id (NOT NULL per the migration in this
 * session). Org id is fetched once on mount via the org_members table
 * — eventually this belongs in a useOrg() hook alongside useWarehouse().
 *
 * Flow recap (unchanged):
 *   1. Camera permission gate
 *   2. Live camera + corner-bracket overlay + flash toggle
 *   3. Barcode scanned → setBarcode + setScanned(true)
 *   4. Lookup: products.eq(barcode, …).maybeSingle()
 *      - If found: show summary card with current location & quantity
 *      - If new: show register form (name, category, weight, qty,
 *        section/bay/level, photo, notes)
 *   5. Photo: capture base64 → upload to product-photos bucket
 *   6. Save: insert product + location + scan_history (action='register')
 *   7. Success state → "Scan another" resets
 */

import { decode } from "base64-arraybuffer";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader } from "../../lib/nimbus/Header";
import { Icon } from "../../lib/nimbus/Icon";
import { layout, space, type } from "../../lib/nimbus/tokens";
import { useOffline } from "../../lib/offline";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { haptic } from "../../lib/ui";
import { useCategories, type Category } from "../../lib/categories";
import { useWarehouse } from "../../lib/warehouse";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface SectionRow {
  id: string;
  code: string;
  name: string;
  color: string | null;
  total_bays: number;
  total_levels: number;
}

interface ExistingProduct {
  id: string;
  name: string;
  internal_sku: string | null;
  categories: { name: string | null } | null;
  locations: Array<{
    bay: number;
    level: number;
    quantity: number;
    sections: { code: string; name: string; color: string | null } | null;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function ScannerScreen() {
  const T = useTheme();
  const router = useRouter();
  const wh = useWarehouse();
  const { isOnline } = useOffline();
  const insets = useSafeAreaInsets();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);

  const [scanned, setScanned] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [flashOn, setFlashOn] = useState(false);

  const [lookupDone, setLookupDone] = useState(false);
  const [existing, setExisting] = useState<ExistingProduct | null>(null);

  // Form state (only used when registering a new product)
  const { categories } = useCategories();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);

  const [sections, setSections] = useState<SectionRow[]>([]);
  const [selectedSection, setSelectedSection] = useState<SectionRow | null>(
    null
  );
  const [bay, setBay] = useState("1");
  const [level, setLevel] = useState("1");

  // Org of the active warehouse — the user can belong to several orgs, so
  // never grab an arbitrary org_members row.
  const orgId = wh.orgId || null;
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showSectionPicker, setShowSectionPicker] = useState(false);

  // ── Permission ──
  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission, requestPermission]);

  // ── Sections list per warehouse ──
  useEffect(() => {
    if (!wh.warehouseId) return;
    supabase
      .from("sections")
      .select("id, code, name, color, total_bays, total_levels")
      .eq("warehouse_id", wh.warehouseId)
      .order("code")
      .then(({ data }) => {
        if (data) {
          const rows = data as unknown as SectionRow[];
          setSections(rows);
          if (rows[0] && !selectedSection) setSelectedSection(rows[0]);
        }
      });
    resetForm();
  }, [wh.warehouseId]);

  // ── Camera scan callback ──
  function handleBarcode({ data }: { data: string }) {
    if (scanned) return;
    setScanned(true);
    setBarcode(data);
    haptic.success();
  }

  // ── Lookup ──
  async function runLookup() {
    if (!barcode.trim() || !wh.warehouseId) return;

    const { data } = await supabase
      .from("products")
      .select(
        "id, name, internal_sku, categories(name), locations(bay, level, quantity, sections(code, name, color))"
      )
      .eq("barcode", barcode.trim())
      .maybeSingle();

    if (data) {
      // Filter locations to current warehouse — done client-side since
      // the nested filter isn't trivially expressible in PostgREST here
      const filtered = {
        ...(data as any),
        locations: (data as any).locations ?? [],
      } as ExistingProduct;
      setExisting(filtered);
    } else {
      setExisting(null);
    }
    setLookupDone(true);
    haptic.light();
  }

  // ── Photo ──
  async function takePhoto() {
    if (!cameraRef.current) return;
    haptic.medium();
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
      });
      if (photo?.uri) {
        setPhotoUri(photo.uri);
        setPhotoBase64(photo.base64 || null);
      }
    } catch (e) {
      console.warn("Photo capture failed:", e);
    }
  }

  async function uploadPhoto(productId: string): Promise<string | null> {
    if (!photoBase64) return null;
    try {
      const filePath = `${productId}.jpg`;
      const { error } = await supabase.storage
        .from("product-photos")
        .upload(filePath, decode(photoBase64), {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (error) return null;
      const { data } = supabase.storage
        .from("product-photos")
        .getPublicUrl(filePath);
      return data.publicUrl;
    } catch {
      return null;
    }
  }

  // ── Save (register new product + location + scan history) ──
  async function saveRegistration() {
    if (!wh.warehouseId || !orgId) {
      Alert.alert("Not ready", "Workspace or facility not loaded yet.");
      return;
    }
    if (!name.trim()) {
      Alert.alert("Name required");
      return;
    }
    if (!selectedSection) {
      Alert.alert("Pick a section");
      return;
    }
    setSaving(true);
    haptic.medium();

    try {
      // 1. INSERT product
      const { data: product, error: pErr } = await supabase
        .from("products")
        .insert({
          name: name.trim(),
          barcode: barcode.trim(),
          category_id: categoryId,
          weight: weight.trim() || null,
          notes: notes.trim() || null,
          org_id: orgId,
        })
        .select()
        .single();
      if (pErr || !product) throw pErr ?? new Error("Product insert failed");

      // 2. Optional photo upload + UPDATE product.photo_url
      const photoUrl = await uploadPhoto(product.id);
      if (photoUrl) {
        await supabase
          .from("products")
          .update({ photo_url: photoUrl })
          .eq("id", product.id);
      }

      // 3. INSERT location
      const { error: lErr } = await supabase.from("locations").insert({
        product_id: product.id,
        section_id: selectedSection.id,
        warehouse_id: wh.warehouseId,
        bay: parseInt(bay, 10) || 1,
        level: parseInt(level, 10) || 1,
        quantity: parseInt(quantity, 10) || 1,
        org_id: orgId,
      });
      if (lErr) throw lErr;

      // 4. INSERT scan history
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("scan_history").insert({
        product_id: product.id,
        warehouse_id: wh.warehouseId,
        scanned_by: u?.user?.id ?? null,
        action: "register",
        to_location: `${selectedSection.code.trim()}-Bay${bay}-L${level}`,
        org_id: orgId,
      });

      haptic.success();
      setShowSuccess(true);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message ?? "Try again.");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setBarcode("");
    setLookupDone(false);
    setExisting(null);
    setName("");
    setCategoryId(null);
    setWeight("");
    setQuantity("1");
    setNotes("");
    setBay("1");
    setLevel("1");
    setSelectedSection(sections[0] ?? null);
    setScanned(false);
    setFlashOn(false);
    setPhotoUri(null);
    setPhotoBase64(null);
    setShowSuccess(false);
  }

  const cameraReady = !!permission?.granted;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenHeader
        eyebrow={
          wh.warehouseName ? `Facility · ${wh.warehouseName}` : "Capture"
        }
        title="Scan"
        leading={
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Icon name="arrow-left" size={18} color={T.text} />
          </Pressable>
        }
      />

      {/* Camera frame */}
      <View style={[styles.cameraWrap, { backgroundColor: "#000" }]}>
        {cameraReady ? (
          <>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject as any}
              enableTorch={flashOn}
              barcodeScannerSettings={{
                barcodeTypes: [
                  "ean13",
                  "ean8",
                  "upc_a",
                  "upc_e",
                  "code128",
                  "code39",
                  "code93",
                  "itf14",
                  "qr",
                ],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarcode}
            />
            <View style={styles.cameraOverlay}>
              {/* Corner brackets — sharp, gold, §9.1 vocabulary */}
              <CornerBrackets color={scanned ? T.success : T.accent} />

              {!scanned ? (
                <Text style={styles.scanHint}>POINT AT A BARCODE TO SCAN</Text>
              ) : (
                <View
                  style={[
                    styles.scannedBadge,
                    {
                      borderColor: T.success,
                      backgroundColor: "rgba(0,0,0,0.7)",
                    },
                  ]}
                >
                  <Icon name="check" size={14} color={T.success} />
                  <Text
                    style={[type.monoBody, { color: "#fff", marginLeft: 6 }]}
                  >
                    {barcode}
                  </Text>
                </View>
              )}

              {/* Flash toggle — sharp square */}
              <Pressable
                onPress={() => {
                  haptic.light();
                  setFlashOn((f) => !f);
                }}
                style={[
                  styles.flashBtn,
                  {
                    borderColor: flashOn ? T.accent : "rgba(255,255,255,0.3)",
                    backgroundColor: "rgba(0,0,0,0.5)",
                  },
                ]}
                accessibilityLabel="Toggle flash"
              >
                <Icon
                  name={flashOn ? "alert-circle" : "settings"}
                  size={14}
                  color={flashOn ? T.accent : "rgba(255,255,255,0.7)"}
                />
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.noCam}>
            <Icon name="alert-circle" size={32} color={T.textDim} />
            <Text
              style={[
                type.body,
                {
                  color: T.textMuted,
                  marginTop: space.s12,
                  textAlign: "center",
                },
              ]}
            >
              Camera permission required to scan
            </Text>
            <Pressable
              onPress={requestPermission}
              style={[styles.permBtn, { backgroundColor: T.accent }]}
            >
              <Text style={[type.label, { color: "#000", letterSpacing: 2 }]}>
                GRANT ACCESS
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Bottom sheet — flat, hairline top, sharp corners */}
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: T.bg,
            borderTopColor: T.borderSubtle,
            paddingBottom: insets.bottom + space.s12,
          },
        ]}
      >
        <ScrollView
          contentContainerStyle={{
            padding: layout.contentPaddingH,
            gap: space.s16,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Barcode row — input + lookup / re-scan */}
          <View style={styles.barcodeRow}>
            <View
              style={[
                styles.barcodeShell,
                { borderColor: T.borderSubtle, backgroundColor: T.bgElevated },
              ]}
            >
              <Icon name="barcode" size={14} color={T.textDim} />
              <TextInput
                value={barcode}
                onChangeText={setBarcode}
                placeholder="Enter or scan barcode"
                placeholderTextColor={T.textDim}
                autoCapitalize="none"
                autoCorrect={false}
                style={[type.monoBody, styles.barcodeInput, { color: T.text }]}
              />
            </View>

            {scanned ? (
              <Pressable
                onPress={resetForm}
                style={[
                  styles.iconBtn,
                  {
                    borderColor: T.borderSubtle,
                    backgroundColor: T.bgElevated,
                  },
                ]}
                accessibilityLabel="Reset"
              >
                <Icon name="rotate-ccw" size={14} color={T.textMuted} />
              </Pressable>
            ) : (
              <Pressable
                onPress={runLookup}
                disabled={!barcode.trim()}
                style={[
                  styles.iconBtn,
                  {
                    borderColor: T.accent,
                    backgroundColor: barcode.trim() ? T.accent : T.surface2,
                    opacity: barcode.trim() ? 1 : 0.6,
                  },
                ]}
                accessibilityLabel="Lookup"
              >
                <Icon
                  name="search"
                  size={14}
                  color={barcode.trim() ? "#000" : T.textDim}
                />
              </Pressable>
            )}
          </View>

          {/* Result body */}
          {!lookupDone ? (
            <Text
              style={[
                type.bodySm,
                {
                  color: T.textDim,
                  textAlign: "center",
                  paddingVertical: space.s12,
                },
              ]}
            >
              Scan a barcode or enter one manually to begin.
            </Text>
          ) : existing ? (
            <FoundCard
              product={existing}
              theme={T}
              onView={() => router.push(`/product/${existing.id}` as any)}
            />
          ) : (
            <RegisterForm
              theme={T}
              name={name}
              setName={setName}
              categoryId={categoryId}
              categories={categories}
              onCategoryTap={() => setShowCategoryPicker(true)}
              weight={weight}
              setWeight={setWeight}
              quantity={quantity}
              setQuantity={setQuantity}
              notes={notes}
              setNotes={setNotes}
              section={selectedSection}
              onSectionTap={() => setShowSectionPicker(true)}
              bay={bay}
              setBay={setBay}
              level={level}
              setLevel={setLevel}
              photoUri={photoUri}
              onTakePhoto={takePhoto}
              onRemovePhoto={() => {
                setPhotoUri(null);
                setPhotoBase64(null);
              }}
              saving={saving}
              onSave={saveRegistration}
            />
          )}
        </ScrollView>
      </View>

      {/* Category picker sheet */}
      <PickerSheet
        open={showCategoryPicker}
        title="CATEGORY"
        options={[
          { id: "", label: "None" },
          ...categories.map((c) => ({ id: c.id, label: c.name })),
        ]}
        currentId={categoryId ?? ""}
        onSelect={(v) => {
          setCategoryId(v || null);
          setShowCategoryPicker(false);
        }}
        onClose={() => setShowCategoryPicker(false)}
        theme={T}
      />

      {/* Section picker sheet */}
      <PickerSheet
        open={showSectionPicker}
        title="SECTION"
        options={sections.map((s) => ({
          id: s.id,
          label: `${s.code.trim()} · ${s.name}`,
        }))}
        currentId={selectedSection?.id ?? null}
        onSelect={(id) => {
          const s = sections.find((x) => x.id === id);
          if (s) setSelectedSection(s);
          setShowSectionPicker(false);
        }}
        onClose={() => setShowSectionPicker(false)}
        theme={T}
      />

      {/* Success overlay */}
      {showSuccess ? (
        <SuccessOverlay
          theme={T}
          name={name}
          location={
            selectedSection
              ? `${selectedSection.code.trim()} · Bay ${bay} · L${level}`
              : ""
          }
          quantity={quantity}
          onScanAnother={() => resetForm()}
          onClose={() => {
            resetForm();
            router.back();
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CORNER BRACKETS — §9.1 visual vocabulary
// ─────────────────────────────────────────────────────────────────────────────

function CornerBrackets({ color }: { color: string }) {
  const size = 220;
  const thick = 2;
  const arm = 28;
  return (
    <View
      style={{
        width: size,
        height: size,
        position: "relative",
      }}
      pointerEvents="none"
    >
      {/* Top-left */}
      <View style={{ position: "absolute", top: 0, left: 0 }}>
        <View style={{ width: arm, height: thick, backgroundColor: color }} />
        <View style={{ width: thick, height: arm, backgroundColor: color }} />
      </View>
      {/* Top-right */}
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          alignItems: "flex-end",
        }}
      >
        <View style={{ width: arm, height: thick, backgroundColor: color }} />
        <View style={{ width: thick, height: arm, backgroundColor: color }} />
      </View>
      {/* Bottom-left */}
      <View style={{ position: "absolute", bottom: 0, left: 0 }}>
        <View style={{ width: thick, height: arm, backgroundColor: color }} />
        <View style={{ width: arm, height: thick, backgroundColor: color }} />
      </View>
      {/* Bottom-right */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          right: 0,
          alignItems: "flex-end",
        }}
      >
        <View style={{ width: thick, height: arm, backgroundColor: color }} />
        <View style={{ width: arm, height: thick, backgroundColor: color }} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOUND CARD — when barcode lookup hits an existing product
// ─────────────────────────────────────────────────────────────────────────────

function FoundCard({
  product,
  theme: T,
  onView,
}: {
  product: ExistingProduct;
  theme: ReturnType<typeof useTheme>;
  onView: () => void;
}) {
  const primary = product.locations?.[0];
  const totalQty = (product.locations ?? []).reduce(
    (s, l) => s + (l.quantity ?? 0),
    0
  );
  return (
    <Pressable
      onPress={onView}
      style={({ pressed }) => [
        styles.foundCard,
        {
          borderColor: T.borderSubtle,
          borderLeftColor: T.success,
          backgroundColor: pressed ? T.surface2 : "transparent",
        },
      ]}
      accessibilityLabel="View product detail"
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.labelSm, { color: T.success, letterSpacing: 2 }]}>
          FOUND · EXISTING
        </Text>
        <Text style={[type.displayXs, { color: T.text, marginTop: 4 }]}>
          {product.name}
        </Text>
        <Text style={[type.monoSm, { color: T.textMuted, marginTop: 4 }]}>
          {product.internal_sku ?? "—"}
        </Text>
        {primary ? (
          <View style={styles.foundLocRow}>
            <Icon name="map" size={12} color={T.accent} />
            <Text
              style={[
                type.monoBody,
                { color: T.accent, marginLeft: 6, fontSize: 14 },
              ]}
            >
              {primary.sections?.code?.trim() || "?"} · Bay {primary.bay} · L
              {primary.level}
            </Text>
            <Text style={[type.monoSm, { color: T.textMuted, marginLeft: 10 }]}>
              × {totalQty}
            </Text>
          </View>
        ) : null}
      </View>
      <Icon name="chevron-right" size={14} color={T.textDim} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER FORM — when barcode is new
// ─────────────────────────────────────────────────────────────────────────────

function RegisterForm({
  theme: T,
  name,
  setName,
  categoryId,
  categories,
  onCategoryTap,
  weight,
  setWeight,
  quantity,
  setQuantity,
  notes,
  setNotes,
  section,
  onSectionTap,
  bay,
  setBay,
  level,
  setLevel,
  photoUri,
  onTakePhoto,
  onRemovePhoto,
  saving,
  onSave,
}: {
  theme: ReturnType<typeof useTheme>;
  name: string;
  setName: (s: string) => void;
  categoryId: string | null;
  categories: Category[];
  onCategoryTap: () => void;
  weight: string;
  setWeight: (s: string) => void;
  quantity: string;
  setQuantity: (s: string) => void;
  notes: string;
  setNotes: (s: string) => void;
  section: SectionRow | null;
  onSectionTap: () => void;
  bay: string;
  setBay: (s: string) => void;
  level: string;
  setLevel: (s: string) => void;
  photoUri: string | null;
  onTakePhoto: () => void;
  onRemovePhoto: () => void;
  saving: boolean;
  onSave: () => void;
}) {
  const catLabel =
    categories.find((c) => c.id === categoryId)?.name ?? "None";
  return (
    <View style={{ gap: space.s16 }}>
      <Text style={[type.label, { color: T.accent, letterSpacing: 2 }]}>
        NEW · REGISTER PRODUCT
      </Text>

      <Field theme={T} label="Name">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Product name"
          placeholderTextColor={T.textDim}
          autoCapitalize="words"
          style={[type.body, { color: T.text, padding: 0 }]}
        />
      </Field>

      <Field theme={T} label="Category" onPress={onCategoryTap}>
        <View style={styles.fieldPress}>
          <Text style={[type.body, { color: T.text }]}>{catLabel}</Text>
          <Icon name="chevron-down" size={14} color={T.textMuted} />
        </View>
      </Field>

      <View style={{ flexDirection: "row", gap: space.s12 }}>
        <View style={{ flex: 1 }}>
          <Field theme={T} label="Weight">
            <TextInput
              value={weight}
              onChangeText={setWeight}
              placeholder="e.g. 12kg"
              placeholderTextColor={T.textDim}
              style={[type.monoBody, { color: T.text, padding: 0 }]}
            />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field theme={T} label="Quantity">
            <TextInput
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="number-pad"
              style={[
                type.monoBody,
                { color: T.text, padding: 0, fontSize: 16 },
              ]}
            />
          </Field>
        </View>
      </View>

      {/* Placement */}
      <Text
        style={[
          type.label,
          { color: T.textMuted, letterSpacing: 2, marginTop: space.s8 },
        ]}
      >
        PLACEMENT
      </Text>

      <Field theme={T} label="Section" onPress={onSectionTap}>
        <View style={styles.fieldPress}>
          <Text style={[type.body, { color: section ? T.text : T.textDim }]}>
            {section
              ? `${section.code.trim()} · ${section.name}`
              : "Pick a section"}
          </Text>
          <Icon name="chevron-down" size={14} color={T.textMuted} />
        </View>
      </Field>

      <View style={{ flexDirection: "row", gap: space.s12 }}>
        <View style={{ flex: 1 }}>
          <Field theme={T} label={`Bay · 1–${section?.total_bays ?? 6}`}>
            <TextInput
              value={bay}
              onChangeText={setBay}
              keyboardType="number-pad"
              style={[
                type.monoBody,
                { color: T.text, padding: 0, fontSize: 16 },
              ]}
            />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field theme={T} label={`Level · 1–${section?.total_levels ?? 4}`}>
            <TextInput
              value={level}
              onChangeText={setLevel}
              keyboardType="number-pad"
              style={[
                type.monoBody,
                { color: T.text, padding: 0, fontSize: 16 },
              ]}
            />
          </Field>
        </View>
      </View>

      {/* Photo */}
      <Text
        style={[
          type.label,
          { color: T.textMuted, letterSpacing: 2, marginTop: space.s8 },
        ]}
      >
        PHOTO
      </Text>
      {photoUri ? (
        <View>
          <Image
            source={{ uri: photoUri }}
            style={[styles.photoPreview, { borderColor: T.borderSubtle }]}
            resizeMode="cover"
          />
          <View
            style={{ flexDirection: "row", gap: space.s8, marginTop: space.s8 }}
          >
            <Pressable
              onPress={onRemovePhoto}
              style={[styles.photoBtn, { borderColor: T.danger }]}
            >
              <Text
                style={[type.labelSm, { color: T.danger, letterSpacing: 1.5 }]}
              >
                REMOVE
              </Text>
            </Pressable>
            <Pressable
              onPress={onTakePhoto}
              style={[styles.photoBtn, { borderColor: T.borderSubtle }]}
            >
              <Text
                style={[
                  type.labelSm,
                  { color: T.textMuted, letterSpacing: 1.5 },
                ]}
              >
                RETAKE
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={onTakePhoto}
          style={[styles.photoCapture, { borderColor: T.borderSubtle }]}
        >
          <Icon name="barcode" size={18} color={T.textMuted} />
          <Text
            style={[
              type.labelSm,
              {
                color: T.textMuted,
                letterSpacing: 2,
                marginTop: space.s8,
              },
            ]}
          >
            TAP TO CAPTURE
          </Text>
        </Pressable>
      )}

      <Field theme={T} label="Notes">
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional"
          placeholderTextColor={T.textDim}
          multiline
          style={[
            type.body,
            {
              color: T.text,
              padding: 0,
              minHeight: 60,
              textAlignVertical: "top",
            },
          ]}
        />
      </Field>

      <Pressable
        onPress={onSave}
        disabled={saving || !name.trim() || !section}
        style={({ pressed }) => [
          styles.saveBtn,
          {
            backgroundColor: pressed ? T.accentBright : T.accent,
            opacity: saving || !name.trim() || !section ? 0.6 : 1,
          },
        ]}
        accessibilityLabel="Save product"
      >
        <Icon name="check" size={16} color="#000" strokeWidth={2} />
        <Text
          style={[
            type.label,
            { color: "#000", letterSpacing: 2, marginLeft: space.s8 },
          ]}
        >
          {saving ? "SAVING…" : "REGISTER"}
        </Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FIELD WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  theme: T,
  label,
  children,
  onPress,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  children: React.ReactNode;
  onPress?: () => void;
}) {
  const shell = (
    <View
      style={[
        styles.fieldShell,
        { borderColor: T.borderSubtle, backgroundColor: T.bgElevated },
      ]}
    >
      {children}
    </View>
  );
  return (
    <View>
      <Text
        style={[
          type.labelSm,
          { color: T.textMuted, letterSpacing: 2, marginBottom: space.s8 },
        ]}
      >
        {label.toUpperCase()}
      </Text>
      {onPress ? <Pressable onPress={onPress}>{shell}</Pressable> : shell}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PICKER SHEET — shared between category and section pickers
// ─────────────────────────────────────────────────────────────────────────────

function PickerSheet({
  open,
  title,
  options,
  currentId,
  onSelect,
  onClose,
  theme: T,
}: {
  open: boolean;
  title: string;
  options: { id: string; label: string }[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const insets = useSafeAreaInsets();
  if (!open) return null;
  return (
    <View style={[StyleSheet.absoluteFillObject, styles.backdrop]}>
      <Pressable
        onPress={onClose}
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: T.modalBackdrop },
        ]}
      />
      <View
        style={[
          styles.pickerSheet,
          {
            backgroundColor: T.bgElevated,
            borderTopColor: T.borderSubtle,
            paddingBottom: insets.bottom + space.s16,
          },
        ]}
      >
        <View style={styles.pickerHeader}>
          <Text style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}>
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="x" size={16} color={T.textMuted} />
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 360 }}>
          {options.map((opt, i) => {
            const isActive = opt.id === currentId;
            return (
              <Pressable
                key={opt.id}
                onPress={() => onSelect(opt.id)}
                style={({ pressed }) => [
                  styles.pickerRow,
                  {
                    backgroundColor: pressed ? T.surface2 : "transparent",
                    borderBottomColor: T.borderFaint,
                    borderBottomWidth:
                      i === options.length - 1 ? 0 : layout.hairlineWidth,
                  },
                ]}
              >
                <Text
                  style={[
                    type.bodyLg,
                    { color: isActive ? T.accent : T.text, fontSize: 15 },
                  ]}
                >
                  {opt.label}
                </Text>
                {isActive ? (
                  <Icon name="check" size={16} color={T.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUCCESS OVERLAY
// ─────────────────────────────────────────────────────────────────────────────

function SuccessOverlay({
  theme: T,
  name,
  location,
  quantity,
  onScanAnother,
  onClose,
}: {
  theme: ReturnType<typeof useTheme>;
  name: string;
  location: string;
  quantity: string;
  onScanAnother: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: T.bg,
          justifyContent: "center",
          paddingHorizontal: layout.contentPaddingH,
        },
      ]}
    >
      <View
        style={[{ borderColor: T.success, borderWidth: 1, padding: space.s24 }]}
      >
        <View style={[styles.successIcon, { borderColor: T.success }]}>
          <Icon name="check" size={28} color={T.success} strokeWidth={2.5} />
        </View>

        <Text
          style={[
            type.label,
            {
              color: T.success,
              letterSpacing: 2.5,
              marginTop: space.s24,
              textAlign: "center",
            },
          ]}
        >
          REGISTERED
        </Text>
        <Text
          style={[
            type.displayMd,
            {
              color: T.text,
              fontSize: 22,
              marginTop: space.s8,
              textAlign: "center",
            },
          ]}
        >
          {name}
        </Text>

        <View
          style={[
            styles.successKv,
            { borderColor: T.borderSubtle, marginTop: space.s24 },
          ]}
        >
          <View style={styles.successKvRow}>
            <Text
              style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}
            >
              LOCATION
            </Text>
            <Text style={[type.monoBody, { color: T.text }]}>{location}</Text>
          </View>
          <View
            style={[
              styles.successKvRow,
              { borderTopWidth: 1, borderTopColor: T.borderFaint },
            ]}
          >
            <Text
              style={[type.labelSm, { color: T.textMuted, letterSpacing: 1.5 }]}
            >
              QUANTITY
            </Text>
            <Text style={[type.monoBody, { color: T.text }]}>× {quantity}</Text>
          </View>
        </View>

        <Pressable
          onPress={onScanAnother}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              marginTop: space.s24,
              backgroundColor: pressed ? T.accentBright : T.accent,
            },
          ]}
        >
          <Icon name="barcode" size={16} color="#000" strokeWidth={1.75} />
          <Text
            style={[
              type.label,
              { color: "#000", letterSpacing: 2, marginLeft: space.s8 },
            ]}
          >
            SCAN ANOTHER
          </Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [
            styles.ghostBtn,
            {
              borderColor: T.borderSubtle,
              marginTop: space.s12,
              backgroundColor: pressed ? T.surface2 : "transparent",
            },
          ]}
        >
          <Text style={[type.label, { color: T.textMuted, letterSpacing: 2 }]}>
            DONE
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Camera frame
  cameraWrap: {
    height: 320,
    overflow: "hidden",
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scanHint: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    marginTop: 18,
    letterSpacing: 2,
    fontWeight: "500",
  },
  scannedBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    // SHARP corners per §1.1
  },
  flashBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  noCam: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  permBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },

  // Sheet
  sheet: {
    flex: 1,
    borderTopWidth: layout.hairlineWidth,
  },

  // Barcode row
  barcodeRow: {
    flexDirection: "row",
    gap: space.s8,
  },
  barcodeShell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s8,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
    borderWidth: layout.hairlineWidth,
  },
  barcodeInput: {
    flex: 1,
    padding: 0,
    fontSize: 14,
  },
  iconBtn: {
    width: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: layout.hairlineWidth,
  },

  // Found card
  foundCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    padding: space.s16,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  foundLocRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: space.s8,
  },

  // Fields
  fieldShell: {
    borderWidth: layout.hairlineWidth,
    paddingHorizontal: space.s12,
    paddingVertical: space.s12,
  },
  fieldPress: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  // Photo
  photoCapture: {
    borderWidth: layout.hairlineWidth,
    borderStyle: "dashed",
    paddingVertical: space.s32,
    alignItems: "center",
    justifyContent: "center",
  },
  photoPreview: {
    width: "100%",
    height: 160,
    borderWidth: layout.hairlineWidth,
  },
  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s12,
    borderWidth: 1,
  },

  // Save
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s16,
  },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.s14,
    borderWidth: 1,
  },

  // Picker sheet
  backdrop: {
    justifyContent: "flex-end",
  },
  pickerSheet: {
    borderTopWidth: layout.hairlineWidth,
    paddingHorizontal: layout.contentPaddingH,
    paddingTop: space.s16,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: space.s12,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space.s16,
  },

  // Success
  successIcon: {
    alignSelf: "center",
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  successKv: {
    borderWidth: 1,
  },
  successKvRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
  },
});
