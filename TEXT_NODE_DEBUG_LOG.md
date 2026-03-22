# TEXT_NODE_DEBUG_LOG — TS Rich Note Debug & Stabilization

## System Prompt Context

Task: Debug, stabilize, and extend the TSRichNote ComfyUI node (rich text editor UI).
Priority bugs: content invisible outside editor (Bug 1), list marker scaling (Bug 2), clear button partial reset (Bug 3).
Feature requests: proper display architecture, drawing capability (after bugs).
Protocol: 5 iterative cycles, each awaiting user visual confirmation.

---

## Architecture Overview

### File Map
- `nodes/rich_note.py` — Minimal Python node (noop, no I/O, category TS_Nodes)
- `web/js/ts_rich_note.js` — ALL logic: editor UI, rendering, serialization, node registration
- `__init__.py` — Registers TSRichNote in NODE_CLASS_MAPPINGS

### Data Flow
1. **Editor open**: `onDblClick` → `openEditor(node)` → creates modal dialog with `contentEditable` div
2. **Editor loads**: `editor.innerHTML = node.properties.html`
3. **Formatting**: `document.execCommand()` for bold/italic/underline/strikethrough/fontSize/color/lists/alignment
4. **Save**: `node.properties.html = editor.innerHTML` → `_cachedImg = null` → `setDirtyCanvas(true, true)`
5. **Display render**: `onDrawForeground` → `sanitizeHtmlForSvg(html)` → `renderHtmlToImage()` (SVG foreignObject → Image via data URI) → `ctx.drawImage()`
6. **Caching**: Render result cached as `_cachedImg` with key `html|w|h|bg|textBg`; cache hit = direct draw
7. **Serialization**: `onSerialize` persists `properties.html`, `bgColor`, `textBgColor`

### Content Format
- Stored as raw HTML string in `node.properties.html`
- Produced by `contentEditable` + `execCommand` (mix of `<span style="...">`, `<font size="N">`, `<b>`, `<i>`, `<ul>`, `<ol>`, etc.)
- Sanitized to XHTML via `XMLSerializer` before SVG embedding

---

## Cycle 1

### Root Causes Found

**Bug 1 — Content invisible outside editor mode**
- Root cause: `requestNodeRedraw(this)` called inside the `renderHtmlToImage` success callback
- `requestNodeRedraw()` sets `_cachedImg = null` and `_cachedKey = ""`
- Flow: render succeeds → `_cachedImg = img` → `requestNodeRedraw()` → `_cachedImg = null` → redraw → image gone → re-render → infinite loop
- The image is never visible because it's cleared before the next draw cycle reads it

**Bug 2 — List marker scaling**
- Root cause: `sanitizeHtmlForSvg` scans `li` children for `el.style.fontSize` (inline CSS only)
- But `document.execCommand("fontSize", false, N)` produces `<font size="N">` elements (HTML attribute, not CSS)
- `parseFloat(el.style.fontSize)` returns NaN for `<font>` elements → maxSize stays 0 → `li` never gets font-size
- `li::marker { font-size: 1em }` in SVG style resolves to default 14px regardless of text size

**Bug 3 — Clear button partial reset**
- Root cause: Clear button calls `document.execCommand("removeFormat")` which only operates on the current selection
- If nothing is selected, nothing happens
- Even with selection, `removeFormat` only strips inline formatting — doesn't delete content, doesn't reset lists/alignment

### Changes Made

**Fix 1** (Bug 1) — In `onDrawForeground` render callback, replaced `requestNodeRedraw(this)` with direct `setDirtyCanvas(true, true)` calls that trigger a redraw WITHOUT clearing the cached image.

**Fix 2** (Bug 2) — In `sanitizeHtmlForSvg`, added `<font size="N">` detection with a size→px mapping table (`fontSizeMap`) alongside the existing inline CSS scan.

**Fix 3** (Bug 3) — Replaced `document.execCommand("removeFormat")` with a custom function that clears `editor.innerHTML`, resets `savedRange`, and re-focuses the editor.

### Files Changed
- `web/js/ts_rich_note.js` — 3 targeted edits (render callback, sanitizer, clear button)

### Tests Run
- Code review: verified no remaining `requestNodeRedraw` calls in render path
- Verified `requestNodeRedraw` still used correctly in menu callbacks (background color, clear note, text bg)
- Manual code trace: save → cache invalidate → render → cache set → dirty canvas → draw cached image ✓

### Open Questions
- `<font>` elements may also need conversion to `<span style="font-size:...">` for consistent SVG rendering (monitor)
- SVG foreignObject rendering may fail on very complex HTML — plaintext fallback exists as safety net
- The `encodeURIComponent` data URI approach has size limits in some browsers for very large content

---

## Next Steps (Cycle 2 — pending user confirmation)
- Verify all 3 fixes visually
- Address any rendering edge cases found during visual testing
- Begin Feature 1 (display architecture separation) if bugs are confirmed fixed
- Investigate Feature 2 (drawing capability) integration approach

---

## Cycle 2

### Issues Reported
1. Padding/margin in TS Rich Note is larger than original Note node — too much whitespace
2. List markers still don't inherit the current text font size when toggled

### Root Causes Found

**Padding**: `PAD = 10` used for both `margin` and `padding` in the SVG inner div = 20px total per side. Original Note node uses minimal spacing.

**List markers in editor**: The list buttons called raw `execCommand("insertUnorderedList"/"insertOrderedList")` which creates `<li>` at browser-default size. The text inside gets wrapped in `<font>`/`<span>` with a size, but the `<li>` itself has no `font-size` → `::marker` stays at default 14px. The Cycle 1 `sanitizeHtmlForSvg` fix handles display-time propagation, but the editor itself also needs real-time propagation so the user sees correct sizes while editing and the HTML is correct at save time.

### Changes Made

1. Reduced `PAD` from `10` to `4` — tighter spacing matching original Note node feel
2. Replaced raw `execCommand` list buttons with `insertListWithSize()` function that:
   - Detects current font-size from selection context (checks inline style AND `<font size="N">` attributes)
   - Executes the list toggle command
   - Propagates detected font-size to any `<li>` elements missing it

### Files Changed
- `web/js/ts_rich_note.js` — 2 edits (PAD constant, list button handlers)
