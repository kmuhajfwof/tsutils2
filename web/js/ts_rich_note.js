import { app } from "../../../scripts/app.js";

/*  ================================================================
 *  TS Rich Note  —  frontend-only rich text note node for ComfyUI
 *  ================================================================
 *  Double-click the node to open a WYSIWYG editor with toolbar:
 *    Bold, Italic, Underline, Strikethrough, Font size,
 *    Text color, Highlight color, Alignment, Clear formatting
 *  Content is stored as HTML in node.properties.html
 *  ================================================================ */

const NODE_TYPE = "TSRichNote";
const TITLE     = "TS Rich Note";
const CATEGORY  = "TS_Nodes";
const MIN_W     = 240;
const MIN_H     = 120;
const PAD       = 4;
const DEFAULT_NODE_BG = "#2a2a2a";
const DEFAULT_TEXT_BG = "transparent";
const NOTE_PANEL_MARGIN = 0;
const NOTE_PANEL_RADIUS = 6;

function requestNodeRedraw(node) {
    node._cachedImg = null;
    node._cachedKey = "";
    node._renderFails = 0;
    node.graph?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas(true, true);
}

/* -------- HTML sanitizer for SVG foreignObject ------------------- */

function sanitizeHtmlForSvg(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    // Propagate font sizes from inline elements to li parents for marker scaling
    tmp.querySelectorAll('li').forEach(li => {
        if (li.style.fontSize) return;
        let maxSize = 0;
        li.querySelectorAll('[style]').forEach(el => {
            const fs = parseFloat(el.style.fontSize);
            if (fs > maxSize) maxSize = fs;
        });
        // Also check <font> elements with size attribute (produced by execCommand)
        const fontSizeMap = { '1': 8, '2': 10, '3': 12, '4': 14, '5': 18, '6': 24, '7': 36 };
        li.querySelectorAll('font[size]').forEach(el => {
            const fs = fontSizeMap[el.getAttribute('size')] || 0;
            if (fs > maxSize) maxSize = fs;
        });
        if (maxSize > 0) li.style.fontSize = maxSize + 'px';
    });
    // Serialize each child node to well-formed XHTML
    const ser = new XMLSerializer();
    let result = '';
    for (const child of tmp.childNodes) {
        result += ser.serializeToString(child);
    }
    // Strip redundant namespace declarations (parent div in SVG already has xmlns)
    result = result.replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
    return result;
}

/* -------- render HTML to offscreen canvas via SVG foreignObject -- */

function renderHtmlToImage(html, width, height, textBgColor, callback) {
    const safeHtml = sanitizeHtmlForSvg(html);
    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml"
         style="width:${width}px;height:${height}px;overflow:hidden;
                color:#ddd;font-family:sans-serif;font-size:14px;
                word-wrap:break-word;padding:0;box-sizing:border-box;
                background:transparent;">
      <div style="margin:${PAD}px;padding:${PAD}px;box-sizing:border-box;
                  border-radius:8px;min-height:calc(100% - ${PAD * 2}px);
                  background:${textBgColor || DEFAULT_TEXT_BG};">
        <style>
          p { margin: 0 0 0.4em 0; }
          ul, ol { margin: 0.2em 0 0.4em 1.5em; padding: 0; }
          li { line-height: 1.35; }
          li::marker { font-size: 1em; color: inherit; }
        </style>
        ${safeHtml}
      </div>
    </div>
  </foreignObject>
</svg>`;
    const img = new Image();
    img.onload = () => callback(img);
    img.onerror = (e) => {
        console.warn('[TS Rich Note] SVG render failed', e);
        callback(null);
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
}

/* -------- plaintext fallback for canvas drawing ------------------ */

function drawPlainTextFallback(ctx, html, x, y, maxW, maxH) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = (tmp.textContent || tmp.innerText || '').trim();
    if (!text) return;
    ctx.fillStyle = '#ccc';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lineH = 17;
    const words = text.split(/\s+/);
    let line = '';
    let cy = y + 6;
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW - 12) {
            if (cy + lineH > y + maxH - 6) { ctx.fillText(line + '…', x + 6, cy); return; }
            ctx.fillText(line, x + 6, cy);
            cy += lineH;
            line = word;
        } else {
            line = test;
        }
    }
    if (line) ctx.fillText(line, x + 6, cy);
}

/* -------- editor dialog ----------------------------------------- */

function openEditor(node) {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "100000",
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center",
    });

    const dialog = document.createElement("div");
    Object.assign(dialog.style, {
        background: "#1e1e1e", borderRadius: "10px",
        width: "620px", maxWidth: "90vw", maxHeight: "85vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
        overflow: "hidden",
    });

    /* ---- toolbar ---- */
    const toolbar = document.createElement("div");
    Object.assign(toolbar.style, {
        display: "flex", flexWrap: "wrap", gap: "2px",
        padding: "8px 10px", background: "#282828",
        borderBottom: "1px solid #444", alignItems: "center",
    });

    let savedRange = null;

    const saveSelection = (editor) => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer)) return;
        savedRange = range.cloneRange();
    };

    const restoreSelection = (editor) => {
        if (!savedRange) return;
        const sel = window.getSelection();
        if (!sel) return;
        sel.removeAllRanges();
        sel.addRange(savedRange);
    };

    const applySelectionStyle = (editor, styles) => {
        restoreSelection(editor);
        editor.focus();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer)) return;

        const span = document.createElement("span");
        Object.assign(span.style, styles);

        if (range.collapsed) {
            span.appendChild(document.createTextNode("\u200b"));
            range.insertNode(span);
            const caret = document.createRange();
            caret.setStart(span.firstChild, 1);
            caret.collapse(true);
            sel.removeAllRanges();
            sel.addRange(caret);
        } else {
            try {
                const fragment = range.extractContents();
                span.appendChild(fragment);
                range.insertNode(span);
                const newRange = document.createRange();
                newRange.selectNodeContents(span);
                sel.removeAllRanges();
                sel.addRange(newRange);
            } catch {
                return;
            }
        }
        saveSelection(editor);
    };

    const mkBtn = (label, title, cmd, value) => {
        const b = document.createElement("button");
        b.innerHTML = label;
        b.title = title;
        Object.assign(b.style, {
            background: "#333", color: "#ccc", border: "1px solid #555",
            borderRadius: "4px", padding: "3px 8px", cursor: "pointer",
            fontSize: "13px", lineHeight: "1.3", minWidth: "28px",
        });
        b.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        b.addEventListener("click", (e) => {
            e.preventDefault();
            restoreSelection(editor);
            editor.focus();
            if (typeof cmd === "function") {
                cmd();
            } else {
                document.execCommand("styleWithCSS", false, true);
                const ok = document.execCommand(cmd, false, value || null);
                if (!ok) {
                    const fallback = {
                        bold: { fontWeight: "bold" },
                        italic: { fontStyle: "italic" },
                        underline: { textDecoration: "underline" },
                        strikeThrough: { textDecoration: "line-through" },
                    };
                    if (fallback[cmd]) applySelectionStyle(editor, fallback[cmd]);
                }
            }
            saveSelection(editor);
        });
        return b;
    };

    const mkSep = () => {
        const s = document.createElement("div");
        Object.assign(s.style, {
            width: "1px", height: "22px", background: "#555", margin: "0 4px",
        });
        return s;
    };

    // --- formatting buttons ---
    toolbar.appendChild(mkBtn("<b>B</b>", "Bold", "bold"));
    toolbar.appendChild(mkBtn("<i>I</i>", "Italic", "italic"));
    toolbar.appendChild(mkBtn("<u>U</u>", "Underline", "underline"));
    toolbar.appendChild(mkBtn("<s>S</s>", "Strikethrough", "strikeThrough"));

    toolbar.appendChild(mkSep());

    // Font size selector
    const sizeSelect = document.createElement("select");
    sizeSelect.title = "Font Size";
    Object.assign(sizeSelect.style, {
        background: "#333", color: "#ccc", border: "1px solid #555",
        borderRadius: "4px", padding: "3px 4px", fontSize: "12px", cursor: "pointer",
    });
    const sizeMap = { 1: "8px", 2: "10px", 3: "12px", 4: "14px", 5: "18px", 6: "24px", 7: "36px" };
    for (const sz of [1, 2, 3, 4, 5, 6, 7]) {
        const labels = ["8px", "10px", "12px", "14px", "18px", "24px", "36px"];
        const opt = document.createElement("option");
        opt.value = sz;
        opt.textContent = labels[sz - 1];
        if (sz === 3) opt.selected = true;
        sizeSelect.appendChild(opt);
    }
    sizeSelect.addEventListener("change", () => {
        restoreSelection(editor);
        editor.focus();
        const px = sizeMap[Number(sizeSelect.value)] || "12px";
        const sel = window.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;

        // Propagate size to parent <li> for marker scaling
        let nodeWalk = range?.commonAncestorContainer || null;
        while (nodeWalk && nodeWalk !== editor) {
            if (nodeWalk.nodeType === 1 && nodeWalk.tagName === "LI") {
                nodeWalk.style.fontSize = px;
                break;
            }
            nodeWalk = nodeWalk.parentNode;
        }

        // Use direct span wrapping — execCommand("fontSize") is unreliable
        applySelectionStyle(editor, { fontSize: px });
        saveSelection(editor);
    });
    toolbar.appendChild(sizeSelect);

    toolbar.appendChild(mkSep());

    // --- color picker popup ---
    const openColorPopup = (anchorEl, initialColor, onSave) => {
        document.querySelectorAll('.ts-color-popup').forEach(p => p.remove());
        const popup = document.createElement('div');
        popup.className = 'ts-color-popup';
        Object.assign(popup.style, {
            position: 'fixed', zIndex: '100001', background: '#2a2a2a',
            border: '1px solid #555', borderRadius: '8px', padding: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)', width: '220px',
        });

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = initialColor;
        Object.assign(colorInput.style, {
            width: '100%', height: '50px', border: 'none', cursor: 'pointer',
            background: 'transparent', padding: '0', display: 'block',
        });
        let currentColor = initialColor;
        colorInput.addEventListener('input', () => {
            currentColor = colorInput.value;
            hexInput.value = currentColor;
            preview.style.background = currentColor;
        });

        const hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.value = initialColor;
        Object.assign(hexInput.style, {
            width: '100%', padding: '4px 6px', marginTop: '8px', background: '#333',
            color: '#ccc', border: '1px solid #555', borderRadius: '4px',
            fontFamily: 'monospace', fontSize: '13px', boxSizing: 'border-box',
        });
        hexInput.addEventListener('input', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) {
                currentColor = hexInput.value;
                colorInput.value = currentColor;
                preview.style.background = currentColor;
            }
        });

        const preview = document.createElement('div');
        Object.assign(preview.style, {
            width: '100%', height: '16px', marginTop: '8px', borderRadius: '4px',
            background: initialColor, border: '1px solid #555',
        });

        const btnRow = document.createElement('div');
        Object.assign(btnRow.style, {
            display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'flex-end',
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        Object.assign(cancelBtn.style, {
            padding: '5px 14px', background: '#333', color: '#ccc',
            border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
        });
        cancelBtn.addEventListener('click', () => popup.remove());
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        Object.assign(saveBtn.style, {
            padding: '5px 14px', background: '#4a7a8a', color: '#fff',
            border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
        });
        saveBtn.addEventListener('click', () => {
            onSave(currentColor);
            popup.remove();
        });
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        popup.appendChild(colorInput);
        popup.appendChild(hexInput);
        popup.appendChild(preview);
        popup.appendChild(btnRow);

        const rect = anchorEl.getBoundingClientRect();
        popup.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
        popup.style.top = Math.min(rect.bottom + 4, window.innerHeight - 250) + 'px';
        document.body.appendChild(popup);
        popup.addEventListener('pointerdown', (e) => e.stopPropagation());
        popup.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    };

    // Text color picker
    const mkColorBtn = (icon, title, cmd) => {
        const btn = document.createElement('button');
        btn.title = title;
        btn.innerHTML = icon;
        Object.assign(btn.style, {
            background: '#333', border: '1px solid #555', borderRadius: '4px',
            padding: '3px 6px', cursor: 'pointer', fontSize: '13px', color: '#ccc',
        });
        let lastColor = cmd === "foreColor" ? "#ffffff" : "#ffff00";
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            saveSelection(editor);
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openColorPopup(btn, lastColor, (color) => {
                lastColor = color;
                restoreSelection(editor);
                editor.focus();
                document.execCommand("styleWithCSS", false, true);
                let ok = document.execCommand(cmd, false, color);
                if (!ok && cmd === "hiliteColor") {
                    ok = document.execCommand("backColor", false, color);
                }
                if (!ok) {
                    if (cmd === "foreColor") {
                        applySelectionStyle(editor, { color });
                    } else {
                        applySelectionStyle(editor, { backgroundColor: color });
                    }
                }
                saveSelection(editor);
            });
        });
        return btn;
    };

    toolbar.appendChild(mkColorBtn("A\u0332", "Text Color", "foreColor"));
    toolbar.appendChild(mkColorBtn("\u{1F58C}", "Highlight", "hiliteColor"));

    // Note background color
    const bgBtn = document.createElement('button');
    bgBtn.title = 'Note Background';
    bgBtn.innerHTML = '\u{1F3A8}';
    Object.assign(bgBtn.style, {
        background: '#333', border: '1px solid #555', borderRadius: '4px',
        padding: '3px 6px', cursor: 'pointer', fontSize: '13px', color: '#ccc',
    });
    bgBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    bgBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openColorPopup(bgBtn, node.properties.textBgColor || '#2a2a2a', (color) => {
            node.properties.textBgColor = color;
            editor.style.background = color;
        });
    });
    toolbar.appendChild(bgBtn);

    toolbar.appendChild(mkSep());

    // Alignment
    toolbar.appendChild(mkBtn("\u2261", "Align Left", "justifyLeft"));
    toolbar.appendChild(mkBtn("\u2263", "Align Center", "justifyCenter"));
    toolbar.appendChild(mkBtn("\u2262", "Align Right", "justifyRight"));

    toolbar.appendChild(mkSep());

    // List — detect current font size and propagate to <li> after toggling
    const insertListWithSize = (cmd) => {
        restoreSelection(editor);
        editor.focus();
        // Detect current font-size from selection context
        const sel = window.getSelection();
        let currentSize = null;
        if (sel && sel.rangeCount) {
            let node = sel.getRangeAt(0).commonAncestorContainer;
            if (node.nodeType === 3) node = node.parentNode;
            while (node && node !== editor) {
                if (node.nodeType === 1) {
                    if (node.style && node.style.fontSize) { currentSize = node.style.fontSize; break; }
                    if (node.tagName === 'FONT' && node.getAttribute('size')) {
                        const map = { '1': '8px', '2': '10px', '3': '12px', '4': '14px', '5': '18px', '6': '24px', '7': '36px' };
                        currentSize = map[node.getAttribute('size')] || null; break;
                    }
                }
                node = node.parentNode;
            }
        }
        document.execCommand(cmd, false, null);
        // Apply detected size to <li> elements that lack it
        if (currentSize) {
            editor.querySelectorAll('li').forEach(li => {
                if (!li.style.fontSize) li.style.fontSize = currentSize;
            });
        }
        saveSelection(editor);
    };
    toolbar.appendChild(mkBtn("• list", "Bullet List", () => insertListWithSize("insertUnorderedList")));
    toolbar.appendChild(mkBtn("1. list", "Numbered List", () => insertListWithSize("insertOrderedList")));

    toolbar.appendChild(mkSep());

    // Clear all content and formatting
    toolbar.appendChild(mkBtn("✕ Clear", "Clear All Content", () => {
        editor.innerHTML = '';
        savedRange = null;
        editor.focus();
    }));

    dialog.appendChild(toolbar);

    /* ---- editable area ---- */
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    const editorBg = (node.properties.textBgColor && node.properties.textBgColor !== "transparent")
        ? node.properties.textBgColor : "#1e1e1e";
    Object.assign(editor.style, {
        flex: "1", minHeight: "250px", maxHeight: "60vh", overflowY: "auto",
        padding: "14px", color: "#ddd", fontFamily: "sans-serif",
        fontSize: "14px", outline: "none", lineHeight: "1.5",
        background: editorBg,
    });
    // Sanitize: only load from stored properties
    editor.innerHTML = node.properties.html || "<p>Double-click to edit...</p>";
    dialog.appendChild(editor);

    editor.addEventListener("keyup", () => saveSelection(editor));
    editor.addEventListener("mouseup", () => saveSelection(editor));
    editor.addEventListener("input", () => saveSelection(editor));

    /* ---- footer buttons ---- */
    const footer = document.createElement("div");
    Object.assign(footer.style, {
        display: "flex", justifyContent: "flex-end", gap: "10px",
        padding: "10px 14px", borderTop: "1px solid #444", background: "#282828",
    });

    const mkFooterBtn = (text, primary, cb) => {
        const b = document.createElement("button");
        b.textContent = text;
        Object.assign(b.style, {
            padding: "7px 20px", border: primary ? "none" : "1px solid #555",
            borderRadius: "6px", cursor: "pointer", fontSize: "13px",
            background: primary ? "#4a7a8a" : "#2a2a2a",
            color: primary ? "#fff" : "#ccc",
        });
        b.addEventListener("click", cb);
        return b;
    };

    footer.appendChild(mkFooterBtn("Cancel", false, () => {
        document.querySelectorAll('.ts-color-popup').forEach(p => p.remove());
        document.body.removeChild(overlay);
    }));
    footer.appendChild(mkFooterBtn("Save", true, () => {
        document.querySelectorAll('.ts-color-popup').forEach(p => p.remove());
        node.properties.html = editor.innerHTML;
        node._cachedImg = null; // invalidate render cache
        app.graph?.setDirtyCanvas(true, true);
        document.body.removeChild(overlay);
    }));
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    overlay.addEventListener("pointerdown", (e) => {
        if (e.target === overlay) {
            document.querySelectorAll('.ts-color-popup').forEach(p => p.remove());
            node.properties.html = editor.innerHTML;
            node._cachedImg = null;
            app.graph?.setDirtyCanvas(true, true);
            document.body.removeChild(overlay);
        }
    });
    document.body.appendChild(overlay);
    editor.focus();
    saveSelection(editor);
}

/* -------- register extension ------------------------------------ */

app.registerExtension({
    name: "ts.RichNote",

    registerCustomNodes() {
        class TSRichNoteNode extends LiteGraph.LGraphNode {
            constructor() {
                super(TITLE);
                this.type = NODE_TYPE;
                this.comfyClass = NODE_TYPE;
                this.isVirtualNode = true;
                this.serialize_widgets = false;
                this.properties = this.properties || {};
                this.properties.html = this.properties.html || "";
                this.properties.bgColor = this.properties.bgColor || DEFAULT_NODE_BG;
                this.properties.textBgColor = this.properties.textBgColor || DEFAULT_TEXT_BG;
                this.properties.hideFrame = this.properties.hideFrame || false;
                this.resizable = true;
                this.size = [320, 200];
                this.widgets = [];

                this._cachedImg = null;
                this._cachedKey = "";
            }

            onDblClick(e, pos, canvas) {
                openEditor(this);
            }

            getExtraMenuOptions() {
                return [
                    {
                        content: "✏ Edit Note",
                        callback: () => openEditor(this),
                    },
                    null,
                    {
                        content: "Background Color",
                        has_submenu: true,
                        submenu: {
                            options: [
                                { content: "Dark (default)", callback: () => { this.properties.bgColor = DEFAULT_NODE_BG; requestNodeRedraw(this); } },
                                { content: "Black",          callback: () => { this.properties.bgColor = "#111111"; requestNodeRedraw(this); } },
                                { content: "Dark Blue",      callback: () => { this.properties.bgColor = "#1a2a3a"; requestNodeRedraw(this); } },
                                { content: "Dark Green",     callback: () => { this.properties.bgColor = "#1a3a2a"; requestNodeRedraw(this); } },
                                { content: "Dark Red",       callback: () => { this.properties.bgColor = "#3a1a1a"; requestNodeRedraw(this); } },
                                { content: "Brown",          callback: () => { this.properties.bgColor = "#3a3020"; requestNodeRedraw(this); } },
                                { content: "Transparent",    callback: () => { this.properties.bgColor = "transparent"; requestNodeRedraw(this); } },
                            ],
                        },
                    },
                    {
                        content: "Text Background",
                        has_submenu: true,
                        submenu: {
                            options: [
                                { content: "Transparent (default)", callback: () => { this.properties.textBgColor = DEFAULT_TEXT_BG; requestNodeRedraw(this); } },
                                { content: "Light Gray",             callback: () => { this.properties.textBgColor = "#3a3a3a"; requestNodeRedraw(this); } },
                                { content: "Dark Gray",              callback: () => { this.properties.textBgColor = "#242424"; requestNodeRedraw(this); } },
                                { content: "Dark Blue",              callback: () => { this.properties.textBgColor = "#1f2f45"; requestNodeRedraw(this); } },
                                { content: "Dark Green",             callback: () => { this.properties.textBgColor = "#1f3a2f"; requestNodeRedraw(this); } },
                                { content: "Dark Red",               callback: () => { this.properties.textBgColor = "#4a2323"; requestNodeRedraw(this); } },
                                { content: "Dark Yellow",            callback: () => { this.properties.textBgColor = "#4a4323"; requestNodeRedraw(this); } },
                            ],
                        },
                    },
                    null,
                    {
                        content: this.properties.hideFrame ? "✓ Show Frame" : "Hide Frame",
                        callback: () => {
                            this.properties.hideFrame = !this.properties.hideFrame;
                            requestNodeRedraw(this);
                        },
                    },
                    {
                        content: "Clear Note",
                        callback: () => {
                            this.properties.html = "";
                            requestNodeRedraw(this);
                        },
                    },
                ];
            }

            onDrawForeground(ctx) {
                if (this.flags.collapsed) return;

                const hide = this.properties.hideFrame;
                const titleH = hide ? 0 : LiteGraph.NODE_TITLE_HEIGHT;
                const w = this.size[0];
                const h = this.size[1] - titleH;
                if (h <= 0 || w <= 0) return;

                const panelX = NOTE_PANEL_MARGIN;
                const panelY = titleH + NOTE_PANEL_MARGIN;
                const panelW = Math.max(0, w - NOTE_PANEL_MARGIN * 2);
                const panelH = Math.max(0, h - NOTE_PANEL_MARGIN * 2);
                if (panelW <= 0 || panelH <= 0) return;

                const html = this.properties.html || "";
                const bg = this.properties.bgColor || DEFAULT_NODE_BG;
                const textBg = this.properties.textBgColor || DEFAULT_TEXT_BG;

                // Rounded panel like original note node
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(panelX, panelY, panelW, panelH, [NOTE_PANEL_RADIUS]);
                if (bg && bg !== "transparent") {
                    ctx.fillStyle = bg;
                    ctx.fill();
                }
                ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.clip();

                // Check for empty or near-empty HTML
                const plainCheck = html.replace(/<[^>]*>/g, '').trim();
                if (!html || !plainCheck) {
                    const scale = (app.canvas?.ds?.scale) || 1;
                    if (scale > 0.4) {
                        ctx.fillStyle = "#666";
                        ctx.font = "13px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText("Double-click to edit", panelX + panelW / 2, panelY + panelH / 2);
                    }
                    ctx.restore();
                    return;
                }

                // Cache key: html + size + bg
                const cacheKey = `${html}|${Math.round(w)}|${Math.round(h)}|${bg}|${textBg}`;
                if (this._cachedImg && this._cachedKey === cacheKey) {
                    ctx.drawImage(this._cachedImg, panelX, panelY, panelW, panelH);
                    ctx.restore();
                    return;
                }

                // Render asynchronously via SVG
                if (!this._rendering && (this._renderFails || 0) < 3) {
                    this._rendering = true;
                    renderHtmlToImage(html, Math.round(w), Math.round(h), textBg, (img) => {
                        this._rendering = false;
                        if (img) {
                            this._cachedImg = img;
                            this._cachedKey = cacheKey;
                            this._renderFails = 0;
                            // Trigger redraw WITHOUT clearing cache (requestNodeRedraw would nuke _cachedImg)
                            this.graph?.setDirtyCanvas?.(true, true);
                            app.graph?.setDirtyCanvas(true, true);
                        } else {
                            this._renderFails = (this._renderFails || 0) + 1;
                            if (this._renderFails >= 3) {
                                this.graph?.setDirtyCanvas?.(true, true);
                                app.graph?.setDirtyCanvas(true, true);
                            }
                        }
                    });
                }

                // Draw cached image or fallback
                if (this._cachedImg) {
                    ctx.drawImage(this._cachedImg, panelX, panelY, panelW, panelH);
                } else if ((this._renderFails || 0) >= 3) {
                    drawPlainTextFallback(ctx, html, panelX, panelY, panelW, panelH);
                }
                ctx.restore();
            }

            computeSize() {
                return [MIN_W, MIN_H];
            }

            onResize(size) {
                size[0] = Math.max(size[0], MIN_W);
                size[1] = Math.max(size[1], MIN_H);
                this._cachedImg = null;
                this._renderFails = 0;
            }

            onDrawBackground(ctx) {
                if (this.properties.hideFrame) {
                    // Suppress default node background/border
                    this.flags.no_title = true;
                    this.title = "";
                } else {
                    this.flags.no_title = false;
                    this.title = TITLE;
                }
            }

            onSerialize(o) {
                o.properties = o.properties || {};
                o.properties.html = this.properties.html || "";
                o.properties.bgColor = this.properties.bgColor || DEFAULT_NODE_BG;
                o.properties.textBgColor = this.properties.textBgColor || DEFAULT_TEXT_BG;
                o.properties.hideFrame = this.properties.hideFrame || false;
            }
        }

        TSRichNoteNode.title = TITLE;
        TSRichNoteNode.type = NODE_TYPE;

        LiteGraph.registerNodeType(NODE_TYPE, TSRichNoteNode);
        TSRichNoteNode.category = CATEGORY;
    },

    loadedGraphNode(node) {
        if (node.type !== NODE_TYPE) return;
        node.properties = node.properties || {};
        node.properties.html = node.properties.html || "";
        node.properties.bgColor = node.properties.bgColor || DEFAULT_NODE_BG;
        node.properties.textBgColor = node.properties.textBgColor || DEFAULT_TEXT_BG;
        node.properties.hideFrame = node.properties.hideFrame || false;
        node._cachedImg = null;
        node._cachedKey = "";
        node._rendering = false;
        node._renderFails = 0;
    },
});
