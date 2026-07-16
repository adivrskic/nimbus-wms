import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { color, space, type } from "../lib/nimbus/tokens";

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>404</Text>
      <Text style={styles.title}>This screen doesn't exist</Text>
      <Text style={styles.body}>
        The route you followed points nowhere. It may have moved, or the link
        is stale.
      </Text>

      <Link href="/" style={styles.link}>
        <Text style={styles.linkText}>Go to home</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.black,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.s32,
  },
  eyebrow: {
    ...type.label,
    color: color.gray3,
    marginBottom: space.s12,
  },
  title: {
    ...type.displayMd,
    color: color.white,
    textAlign: "center",
    marginBottom: space.s8,
  },
  body: {
    ...type.body,
    color: color.gray2,
    textAlign: "center",
    marginBottom: space.s32,
  },
  link: {
    paddingVertical: space.s12,
    paddingHorizontal: space.s16,
    borderWidth: 1,
    borderColor: color.accent,
  },
  linkText: {
    ...type.label,
    color: color.accent,
  },
});
