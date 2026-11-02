/**
 * Founder 2026-11-02 visual tripwire, not a device screenshot test.
 * Code review must still inspect iconography, layout and accessibility.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const main = "apps/android/app/src/main/java/com/rekixo/jodlo/";
async function requireText(file) {
    return readFile(join(root, file), "utf8");
}
const [theme, components, customer, worker, reference, design, flowSvg, iconsSvg] = await Promise.all([
    main + "ui/theme/JodloTheme.kt", main + "ui/theme/JodloComponents.kt",
    main + "MainActivity.kt", main + "WorkerDashboard.kt",
    "docs/UI_REFERENCE_2026-11-02.md", "docs/DESIGN_SYSTEM.md",
    "docs/assets/reference-flat-flow.svg", "docs/assets/reference-icon-actions.svg",
].map(requireText));
const errors = [];
for (const [label, needle] of Object.entries({
    canvas: "Color(0xFF000000)",
    neutralOutline: "Color(0xFF262626)",
    selectedOutline: "Color(0xFF08391A)",
    activeGreen: "Color(0xFF40C877)",
    stroke: "val Stroke = 1.dp",
    darkTheme: "colorScheme = JodloDarkColors",
})) if (!theme.includes(needle)) errors.push("Missing approved "+label+" token");
if (/lightColorScheme|isSystemInDarkTheme|shadowElevation\s*=\s*[1-9]/.test(theme))
    errors.push("Dark-only founder theme cannot auto-switch to light or add shadows");
for (const control of ["JodloButton", "JodloTextAction", "JodloCard",
    "JodloChip", "JodloSearchField", "JodloSquareAction"])
    if (!components.includes("fun "+control+"(")) errors.push("Missing shared "+control);
if (!components.includes("defaultElevation = 0.dp"))
    errors.push("Outlined cards must remain flat at zero elevation");
for (const [name, source] of [["Customer", customer], ["Worker", worker]]) {
    if (/\b(?:Button|TextButton|OutlinedCard|FilterChip|OutlinedTextField)\s*\(/.test(source))
        errors.push(name+" reintroduced raw Material control instead of shared JODLO component");
    if (/Color\s*\(\s*0x[0-9a-f]/i.test(source))
        errors.push(name+" placed a raw palette literal in a screen");
    if (!source.includes("JodloCard(") || !source.includes("JodloButton("))
        errors.push(name+" no longer uses reusable flat UI components");
}
if (!customer.includes("JodloChip(") || !customer.includes("JodloSearchField("))
    errors.push("Customer filters and fields must use shared components");
for (const [name, source] of [["ref", reference], ["design", design]]) {
    if (!source.includes("2026-11-02") || !/approved/i.test(source))
        errors.push(name+" missing founder design approval");
}
if (!flowSvg.includes("#08391a") || !iconsSvg.includes("#40c877"))
    errors.push("Committed visual reference redraws missing approved green strokes");
if (errors.length) {
    console.error("JODLO approved UI audit FAILED:\n"+errors.join("\n"));
    process.exitCode = 1;
} else {
    console.log("JODLO approved flat UI audit OK — dark-only tokens, shared controls, both native screens and SVG references.");
}
