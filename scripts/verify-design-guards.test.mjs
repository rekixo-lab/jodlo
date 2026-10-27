import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditDesignRules } from "./verify-design-guards.mjs";

async function fixture(files, action) {
  const root = await mkdtemp(join(tmpdir(), "jodlo-design-"));
  try {
    for (const [path, body] of Object.entries(files)) {
      const name = join(root, path);
      await mkdir(join(name, ".."), { recursive: true });
      await writeFile(name, body);
    }
    return await action(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const kt = "apps/android/app/src/main/java/com/rekixo/jodlo/feature/home/HomeScreen.kt";
const theme = "apps/android/app/src/main/java/com/rekixo/jodlo/core/designsystem/theme/JodloColors.kt";

test("clean resource refs and theme-owned colors pass", async () => {
  const r = await fixture({
    [kt]: 'Text(text = stringResource(R.string.home))\nval color = MaterialTheme.colorScheme.primary',
    [theme]: 'val JodloPrimary = Color(0xFF00CCBB)',
    "apps/android/app/src/main/res/layout/welcome.xml": '<TextView android:text="@string/welcome"/>',
  }, auditDesignRules);
  assert.deepEqual(r.errors, []); assert.equal(r.kotlinFiles, 2);
});

test("reject inline Compose strings, raw colors and untokenized corners", async () => {
  const r = await fixture({
    [kt]: 'Text("Hello")\nval x = Color(0xFF12AB34)\nval corner = RoundedCornerShape(10.dp)',
  }, auditDesignRules);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors.join(" "), /Inline Compose Text literal/);
  assert.match(r.errors.join(" "), /Raw Compose color literal/);
});

test("reject inline Kotlin labels, border, font and animation constants", async () => {
  const r = await fixture({
    [kt]: 'Text(text = "Welcome")\ncontentDescription = "tab"\nfontSize = 16.sp\nBorderStroke(1.dp)\nanimationSpec = tween(200)',
  }, auditDesignRules);
  assert.equal(r.errors.length, 5);
});

test("reject UI raw XML string and XML hex color", async () => {
  const r = await fixture({
    "apps/android/app/src/main/res/layout/page.xml": '<TextView android:text="Welcome" android:textColor="#00AAFF"/>',
  }, auditDesignRules);
  assert.equal(r.errors.length, 2);
});

test("reject byte-identical assets across Android resources and web public", async () => {
  const r = await fixture({
    "apps/android/app/src/main/res/drawable/icon.svg": '<svg viewBox="0 0 1 1"></svg>',
    "apps/web/public/icon.svg": '<svg viewBox="0 0 1 1"></svg>',
  }, auditDesignRules);
  assert.equal(r.assetFiles, 2);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /Duplicate media asset bytes/);
});

test("skip tests and unused directories; no false duplicate on distinct images", async () => {
  const r = await fixture({
    [kt]: 'Text(text = stringResource(R.string.worker))',
    "apps/android/app/src/test/java/com/rekixo/jodlo/FakeTest.kt": 'Text("test sample")',
    "apps/android/app/src/main/res/drawable/icon_a.svg": "<svg>a</svg>",
    "apps/android/app/src/main/res/drawable/icon_b.svg": "<svg>b</svg>",
  }, auditDesignRules);
  assert.deepEqual(r.errors, []);
});
