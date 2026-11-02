# JODLO motion specification — founder update 2026-11-02

**Current founder instruction supersedes earlier visual-depth and 3D ideas.**
The UI must remain flat and minimal, like the approved user-supplied black
screenshots. See [Design system](DESIGN_SYSTEM.md) and
[Approved reference](UI_REFERENCE_2026-11-02.md).

- No continuous parallax, mandatory animated heroes, 3D models, glass,
  gradients, heavy shadow, glowing cards, distracting ripples or deep elevation.
- Direct, immediate, interruptible state changes. A brief native pressed or
  selected-state feedback is acceptable only when it serves an action.
- No navigation animation required; real content and touch feedback win.
- Honor system reduced-motion settings, screen reader focus and font scaling.
- Local success/uncertain-write states must be truthful and comprehensible even
  with motion entirely disabled.
- Keep 48dp minimum interactive targets despite visually compact icon tiles.
- Actual on-device performance, 320dp layout, scrolling and TalkBack tests are
  still pending. Do not claim a smooth/60fps device result based on static CI.

The older proposals (Lottie/Rive, 2.5D depth, perspective tilt, video-style
hero reveals) were brainstorming and are **not** the approved JODLO default.
