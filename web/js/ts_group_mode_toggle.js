import { app } from "../../../scripts/app.js";

/*  ================================================================
 *  TS Group Mode Toggle  —  frontend-only ComfyUI node
 *  ================================================================
 *  Shows mute/unmute toggles ONLY for groups the user explicitly
 *  picked via a "⚙ Settings" button at the bottom of the node.
 *  Selected group names are persisted in node.properties.selectedGroups.
 *  ================================================================ */

const NODE_TYPE   = "TSGroupModeToggle";
const TITLE       = "TS Group Mode Toggle";
const CATEGORY    = "TS_Nodes";
const WIDGET_H    = 20;
const MARGIN      = 15;
const NAV_AREA    = 28;
const SETTINGS_H  = 24;

/* ---------- tiny helpers ---------------------------------------- */

function fitString(ctx, str, maxWidth) {
    let w = ctx.measureText(str).width;
    if (w <= maxWidth) return str;
    const ellipsis = "…";
    const ew = ctx.measureText(ellipsis).width;
    if (w <= ew) return str;
    let lo = 0, hi = str.length;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (ctx.measureText(str.substring(0, mid)).width < maxWidth - ew) lo = mid + 1;
        else hi = mid - 1;
    }
    return str.substring(0, hi) + ellipsis;
}

function isLowQuality() {
    return ((app.canvas?.ds?.scale) || 1) <= 0.5;
}

function getGroupNodes(group) {
    // Try built-in properties first (_children / _nodes)
    const source = group._children || group._nodes;
    if (source && source.length) {
        return Array.from(source).filter(c => c && typeof c.mode !== "undefined");
    }
    // Fallback: compute nodes inside the group bounding box
    const graph = app.graph;
    if (!graph || !group._pos || !group._size) return [];
    const [gx, gy] = group._pos;
    const [gw, gh] = group._size;
    return (graph._nodes || []).filter(n => {
        if (!n || typeof n.mode === "undefined") return false;
        const nx = n.pos[0];
        const ny = n.pos[1];
        return nx >= gx && ny >= gy && nx < gx + gw && ny < gy + gh;
    });
}

function changeModeOfNodes(nodes, mode) {
    if (!Array.isArray(nodes)) nodes = [nodes];
    for (const n of nodes) {
        if (n) n.mode = mode;
    }
}

function getAllGroups() {
    const graph = app.graph;
    if (!graph) return [];
    return graph._groups || [];
}

function groupHasActiveNode(group) {
    return getGroupNodes(group).some(n => n.mode === LiteGraph.ALWAYS);
}

/** Return the numeric LiteGraph mode for the "off" state. */
function getOffMode(node) {
    return (node.properties?.toggleMode === "bypass") ? 4 : LiteGraph.NEVER;
}

/* ---------- Settings dialog ------------------------------------- */

function openSettingsDialog(node) {
    const groups = getAllGroups();
    if (!groups.length) {
        alert("No groups found in the current workflow.");
        return;
    }

    const selected = new Set(node.properties.selectedGroups || []);

    // Build dialog
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "100000",
        background: "rgba(0,0,0,0.55)", display: "flex",
        alignItems: "center", justifyContent: "center",
    });

    const dialog = document.createElement("div");
    Object.assign(dialog.style, {
        background: "#1e1e1e", borderRadius: "10px", padding: "18px 22px",
        minWidth: "320px", maxWidth: "460px", maxHeight: "70vh",
        color: "#ddd", fontFamily: "sans-serif", fontSize: "14px",
        display: "flex", flexDirection: "column", gap: "10px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    });

    const title = document.createElement("div");
    title.textContent = "Select groups to display";
    Object.assign(title.style, { fontWeight: "bold", fontSize: "15px", marginBottom: "4px" });
    dialog.appendChild(title);

    // Select All / Deselect All
    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "8px", marginBottom: "2px" });

    const mkSmallBtn = (text, cb) => {
        const b = document.createElement("button");
        b.textContent = text;
        Object.assign(b.style, {
            padding: "4px 12px", border: "1px solid #555", borderRadius: "5px",
            background: "#2a2a2a", color: "#ccc", cursor: "pointer", fontSize: "12px",
        });
        b.addEventListener("click", cb);
        return b;
    };
    btnRow.appendChild(mkSmallBtn("Select All", () => {
        listEl.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = true);
    }));
    btnRow.appendChild(mkSmallBtn("Deselect All", () => {
        listEl.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = false);
    }));
    dialog.appendChild(btnRow);

    // Toggle mode selector (Mute / Bypass)
    const modeRow = document.createElement("div");
    Object.assign(modeRow.style, {
        display: "flex", alignItems: "center", gap: "12px",
        marginBottom: "4px", padding: "4px 6px",
    });
    const modeLbl = document.createElement("span");
    modeLbl.textContent = "Off mode:";
    Object.assign(modeLbl.style, { fontSize: "13px", color: "#aaa" });
    modeRow.appendChild(modeLbl);

    const currentMode = node.properties.toggleMode || "mute";
    for (const [val, label] of [["mute", "Mute"], ["bypass", "Bypass"]]) {
        const rlbl = document.createElement("label");
        Object.assign(rlbl.style, { display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", fontSize: "13px" });
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "ts_toggle_mode";
        radio.value = val;
        radio.checked = (currentMode === val);
        radio.style.accentColor = "#89A";
        const sp = document.createElement("span");
        sp.textContent = label;
        rlbl.appendChild(radio);
        rlbl.appendChild(sp);
        modeRow.appendChild(rlbl);
    }
    dialog.appendChild(modeRow);

    // Scrollable checkboxes list
    const listEl = document.createElement("div");
    Object.assign(listEl.style, {
        overflowY: "auto", maxHeight: "45vh", display: "flex",
        flexDirection: "column", gap: "4px", padding: "4px 0",
    });

    const sortedGroups = [...groups].sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    for (const g of sortedGroups) {
        const row = document.createElement("label");
        Object.assign(row.style, {
            display: "flex", alignItems: "center", gap: "8px",
            cursor: "pointer", padding: "3px 6px", borderRadius: "5px",
        });
        row.addEventListener("mouseenter", () => row.style.background = "#333");
        row.addEventListener("mouseleave", () => row.style.background = "none");

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(g.title);
        cb.dataset.groupTitle = g.title;
        cb.style.accentColor = "#89A";

        const lbl = document.createElement("span");
        lbl.textContent = g.title;

        // color indicator
        if (g.color) {
            const dot = document.createElement("span");
            Object.assign(dot.style, {
                width: "10px", height: "10px", borderRadius: "50%",
                background: g.color, display: "inline-block", flexShrink: "0",
            });
            row.appendChild(cb);
            row.appendChild(dot);
            row.appendChild(lbl);
        } else {
            row.appendChild(cb);
            row.appendChild(lbl);
        }
        listEl.appendChild(row);
    }
    dialog.appendChild(listEl);

    // Buttons
    const footer = document.createElement("div");
    Object.assign(footer.style, {
        display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px",
    });

    const mkBtn = (text, primary, cb) => {
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

    footer.appendChild(mkBtn("Cancel", false, () => document.body.removeChild(overlay)));
    footer.appendChild(mkBtn("Apply", true, () => {
        const checked = [];
        listEl.querySelectorAll("input[type=checkbox]").forEach(cb => {
            if (cb.checked) checked.push(cb.dataset.groupTitle);
        });
        node.properties.selectedGroups = checked;
        const selRadio = modeRow.querySelector("input[type=radio]:checked");
        node.properties.toggleMode = selRadio ? selRadio.value : "mute";
        refreshToggleWidgets(node);
        document.body.removeChild(overlay);
        app.graph?.setDirtyCanvas(true, true);
    }));
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    overlay.addEventListener("pointerdown", (e) => {
        if (e.target === overlay) document.body.removeChild(overlay);
    });
    document.body.appendChild(overlay);
}

/* ---------- widget drawing helpers ------------------------------ */

function drawWidgetBackground(ctx, width, posY, height) {
    const lowQ = isLowQuality();
    const data = {
        width, height, posY, lowQ, margin: MARGIN,
        colorOutline: LiteGraph.WIDGET_OUTLINE_COLOR,
        colorBg:      LiteGraph.WIDGET_BGCOLOR,
        colorText:    LiteGraph.WIDGET_TEXT_COLOR,
        colorText2:   LiteGraph.WIDGET_SECONDARY_TEXT_COLOR,
    };
    ctx.strokeStyle = data.colorOutline;
    ctx.fillStyle   = data.colorBg;
    ctx.beginPath();
    ctx.roundRect(data.margin, posY, width - data.margin * 2, height,
                  lowQ ? [0] : [height * 0.5]);
    ctx.fill();
    if (!lowQ) ctx.stroke();
    return data;
}

/* ---------- refresh the toggle widgets for the node ------------- */

function refreshToggleWidgets(node) {
    const selectedNames = node.properties.selectedGroups || [];
    const groups = getAllGroups();

    // Build a map title -> group for quick lookup
    const groupMap = {};
    for (const g of groups) groupMap[g.title] = g;

    // Keep only those in 'selectedNames' that still exist
    const validNames = selectedNames.filter(n => groupMap[n]);

    // -- sync widgets (excluding the last settings-button widget) --
    const settingsWidget = node.widgets?.find(w => w._isSettingsBtn);

    // Remove old toggle widgets
    node.widgets = node.widgets
        ? node.widgets.filter(w => w._isSettingsBtn)
        : [];

    // Create ordered toggle widgets
    for (const name of validNames) {
        const g = groupMap[name];
        if (!g) continue;
        const w = {
            type: "custom",
            name: "toggle_" + name,
            label: "Enable " + name,
            _isToggle: true,
            _group: g,
            toggled: groupHasActiveNode(g),
            options: { on: "yes", off: "no" },
            value: { toggled: groupHasActiveNode(g) },
            computeSize() { return [0, WIDGET_H]; },
            serializeValue() { return this.value; },

            /* — draw — */
            draw(ctx, nodeRef, w, posY, height) {
                const wd = drawWidgetBackground(ctx, nodeRef.size[0], posY, height);

                let currentX = wd.width - wd.margin;

                // Nav arrow
                if (!wd.lowQ) {
                    currentX -= 7;
                    const midY = wd.posY + wd.height * 0.5;
                    ctx.fillStyle = ctx.strokeStyle = "#89A";
                    ctx.lineJoin = "round";
                    ctx.lineCap  = "round";
                    const arrow = new Path2D(
                        `M${currentX} ${midY} l -7 6 v -3 h -7 v -6 h 7 v -3 z`
                    );
                    ctx.fill(arrow);
                    ctx.stroke(arrow);
                    currentX -= 14;
                    currentX -= 7;
                    ctx.strokeStyle = wd.colorOutline;
                    ctx.stroke(new Path2D(
                        `M ${currentX} ${wd.posY} v ${wd.height}`
                    ));
                } else {
                    currentX -= NAV_AREA;
                }

                // Toggle circle
                currentX -= 7;
                ctx.fillStyle = this.toggled ? "#89A" : "#333";
                ctx.beginPath();
                const r = height * 0.36;
                ctx.arc(currentX - r, posY + height * 0.5, r, 0, Math.PI * 2);
                ctx.fill();
                currentX -= r * 2;

                if (!wd.lowQ) {
                    currentX -= 4;
                    ctx.textAlign = "right";
                    ctx.fillStyle = this.toggled ? wd.colorText : wd.colorText2;
                    const onLbl  = this.options.on  || "true";
                    const offLbl = this.options.off || "false";
                    ctx.fillText(this.toggled ? onLbl : offLbl,
                                 currentX, posY + height * 0.7);
                    currentX -= Math.max(
                        ctx.measureText(onLbl).width,
                        ctx.measureText(offLbl).width
                    );

                    currentX -= 7;
                    ctx.textAlign = "left";
                    const maxLbl = wd.width - wd.margin - 10 - (wd.width - currentX);
                    ctx.fillText(
                        fitString(ctx, this.label, maxLbl),
                        wd.margin + 10, posY + height * 0.7
                    );
                }
            },

            /* — mouse — */
            mouse(event, pos, nodeRef) {
                if (event.type !== "pointerdown") return true;

                // Right area -> navigate to group
                if (pos[0] >= nodeRef.size[0] - MARGIN - NAV_AREA - 1) {
                    if (!isLowQuality()) {
                        const canvas = app.canvas;
                        canvas.centerOnNode(this._group);
                        const zc = canvas.ds?.scale || 1;
                        const zx = canvas.canvas.width  / this._group._size[0] - 0.02;
                        const zy = canvas.canvas.height / this._group._size[1] - 0.02;
                        canvas.setZoom(Math.min(zc, zx, zy), [
                            canvas.canvas.width  / 2,
                            canvas.canvas.height / 2,
                        ]);
                        canvas.setDirty(true, true);
                    }
                    return true;
                }

                // Toggle
                const wasToggled = this.toggled;
                const newVal = !wasToggled;
                changeModeOfNodes(
                    getGroupNodes(this._group),
                    newVal ? LiteGraph.ALWAYS : getOffMode(nodeRef)
                );
                this.toggled = newVal;
                this.value.toggled = newVal;
                app.graph?.setDirtyCanvas(true, false);
                return true;
            },
        };
        node.widgets.splice(node.widgets.length - (settingsWidget ? 1 : 0), 0, w);
    }

    // Ensure settings button exists and is always last
    if (!node.widgets.find(w => w._isSettingsBtn)) {
        node.widgets.push(makeSettingsButtonWidget());
    }

    // Resize
    node.setSize(node.computeSize());
    app.graph?.setDirtyCanvas(true, true);
}

/* ---------- settings button widget ------------------------------ */

function makeSettingsButtonWidget() {
    return {
        type: "custom",
        name: "ts_settings_btn",
        _isSettingsBtn: true,
        value: 0,
        options: {},
        computeSize() { return [0, SETTINGS_H]; },
        serializeValue() { return null; },

        draw(ctx, nodeRef, w, posY, height) {
            const lowQ = isLowQuality();
            const mx = MARGIN;
            const bw = nodeRef.size[0] - mx * 2;

            // Button background
            ctx.fillStyle = "#3a3a3a";
            ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR;
            ctx.beginPath();
            ctx.roundRect(mx, posY + 2, bw, height - 4, lowQ ? [0] : [6]);
            ctx.fill();
            if (!lowQ) ctx.stroke();

            // Button text
            if (!lowQ) {
                ctx.fillStyle = "#bbb";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("⚙  Settings", mx + bw / 2, posY + height / 2);
            }
        },

        mouse(event, pos, nodeRef) {
            if (event.type === "pointerdown") {
                openSettingsDialog(nodeRef);
                return true;
            }
            return true;
        },
    };
}

/* ---------- periodic refresh ------------------------------------ */

let _refreshInterval = null;

function startPeriodicRefresh() {
    if (_refreshInterval) return;
    _refreshInterval = setInterval(() => {
        const groups = getAllGroups();
        if (!groups.length) return;

        // For each registered TS Group Toggle node, update toggled states
        const graph = app.graph;
        if (!graph) return;
        for (const node of graph._nodes || []) {
            if (node.type !== NODE_TYPE) continue;
            const selectedNames = node.properties?.selectedGroups || [];
            if (!selectedNames.length) continue;

            const groupMap = {};
            for (const g of groups) groupMap[g.title] = g;

            let dirty = false;
            for (const w of node.widgets || []) {
                if (!w._isToggle || !w._group) continue;
                // Re-link in case groups got recreated
                if (groupMap[w._group.title]) {
                    w._group = groupMap[w._group.title];
                }
                const active = groupHasActiveNode(w._group);
                if (w.toggled !== active) {
                    w.toggled = active;
                    w.value.toggled = active;
                    dirty = true;
                }
            }
            if (dirty) {
                app.graph?.setDirtyCanvas(true, false);
            }
        }
    }, 500);
}

/* ---------- register extension ---------------------------------- */

app.registerExtension({
    name: "ts.GroupModeToggle",

    registerCustomNodes() {
        // Create a frontend-only virtual node class
        class TSGroupModeToggleNode extends LiteGraph.LGraphNode {
            constructor() {
                super(TITLE);
                this.type = NODE_TYPE;
                this.comfyClass = NODE_TYPE;
                this.isVirtualNode = true;
                this.serialize_widgets = false;
                this.properties = this.properties || {};
                this.properties.selectedGroups = this.properties.selectedGroups || [];
                this.properties.toggleMode = this.properties.toggleMode || "mute";
                this.color = "#1a1a1a";
                this.widgets_start_y = 10;

                // Init with the settings button
                this.widgets = [];
                this.widgets.push(makeSettingsButtonWidget());

                this.setSize(this.computeSize());
            }

            onAdded() {
                startPeriodicRefresh();
                // Delay first refresh so the graph is fully loaded
                setTimeout(() => refreshToggleWidgets(this), 300);
            }

            onRemoved() {
                // nothing - interval is global and lightweight
            }

            computeSize() {
                const toggleCount = (this.widgets || []).filter(w => w._isToggle).length;
                const hasSettings = (this.widgets || []).some(w => w._isSettingsBtn);
                const h = LiteGraph.NODE_TITLE_HEIGHT
                    + 6
                    + toggleCount * WIDGET_H
                    + (hasSettings ? SETTINGS_H : 0)
                    + 6;
                return [280, h];
            }

            getExtraMenuOptions() {
                return [
                    {
                        content: "⚙ Group Settings",
                        callback: () => openSettingsDialog(this),
                    },
                    null, // separator
                    {
                        content: "Disable All",
                        callback: () => {
                            const offMode = getOffMode(this);
                            for (const w of this.widgets || []) {
                                if (!w._isToggle) continue;
                                changeModeOfNodes(getGroupNodes(w._group), offMode);
                                w.toggled = false;
                                w.value.toggled = false;
                            }
                            app.graph?.setDirtyCanvas(true, false);
                        },
                    },
                    {
                        content: "Enable All",
                        callback: () => {
                            for (const w of this.widgets || []) {
                                if (!w._isToggle) continue;
                                changeModeOfNodes(getGroupNodes(w._group), LiteGraph.ALWAYS);
                                w.toggled = true;
                                w.value.toggled = true;
                            }
                            app.graph?.setDirtyCanvas(true, false);
                        },
                    },
                    {
                        content: "Toggle All",
                        callback: () => {
                            const offMode = getOffMode(this);
                            for (const w of this.widgets || []) {
                                if (!w._isToggle) continue;
                                const nv = !w.toggled;
                                changeModeOfNodes(getGroupNodes(w._group),
                                    nv ? LiteGraph.ALWAYS : offMode);
                                w.toggled = nv;
                                w.value.toggled = nv;
                            }
                            app.graph?.setDirtyCanvas(true, false);
                        },
                    },
                ];
            }
        }

        TSGroupModeToggleNode.title = TITLE;
        TSGroupModeToggleNode.type  = NODE_TYPE;
        TSGroupModeToggleNode["@selectedGroups"] = { type: "string" };

        LiteGraph.registerNodeType(NODE_TYPE, TSGroupModeToggleNode);
        TSGroupModeToggleNode.category = CATEGORY;
    },

    loadedGraphNode(node) {
        if (node.type !== NODE_TYPE) return;
        node.properties = node.properties || {};
        node.properties.selectedGroups = node.properties.selectedGroups || [];
        node.properties.toggleMode = node.properties.toggleMode || "mute";
        startPeriodicRefresh();
        setTimeout(() => refreshToggleWidgets(node), 400);
    },
});
