## JODLO Pull Request — Reuse and quality review

**Change scope:** Explain what was implemented and what remains unverified. No Cloudflare deployment while coding.

### Required checks
- [ ] Reused suitable tested domain/UI/components/helpers/contracts/assets; documented any new shared abstraction and why necessary; removed duplicate/dead/unneeded code.
- [ ] No byte-identical or visually redundant media, or oversized/unused SDKs. Static duplicate check cannot detect visually similar images; manual review required.
- [ ] Android UI text/content descriptions localized; colors, typography, radius/shapes, stroke, spacing, elevations and motion from founder-approved common tokens, not per-screen literals.
- [ ] Before UI implementation: founder explicitly approved actual palette/screens/navigation, animated tabs/actions/3D proposal; link evidence (quality requirement alone is **not** design approval).
- [ ] Purposeful smooth transitions/action feedback and selective 3D/2.5D, reduced-motion/static fallback, accessibility, interruptibility and measured low-end APK/memory/frame/thermal metrics when UI exists.
- [ ] `npm run docs:check`, `npm run design:check`, `npm test`, TypeScript/Android checks and actual green hosted CI. Status/handoff updates and PR source reviewed.
- [ ] No live/legacy infrastructure, payments, Cloudflare staging or production deployment was changed.
- [ ] Checked [manual owner-action register](../docs/MANUAL_ACTIONS.md): proactively told founder about any NOW blocking manual gate, did not silently assume approval, recorded any decisions with evidence; future-only tasks remain deferred.

### Evidence
Existing code/assets reused:

New shared APIs/components/resources and justification:

Tests/metrics and any unverified device performance:

UI design approval link (if applicable):

Manual owner-action IDs / state / founder conversation evidence (or none required):

Remaining gates:

[ADR-0005](../docs/decisions/0005-reuse-tokens-premium-motion.md) · [Design](../docs/DESIGN_SYSTEM.md) · [Motion](../docs/MOTION_3D.md) · [Reuse](../docs/REUSE_ASSET_POLICY.md)
