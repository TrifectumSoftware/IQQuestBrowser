/* IQ Quest Browser — a faithful re-implementation of BetterQuesting's quest line view.
 *
 * Geometry, colours and textures mirror the BQ 3.x source:
 *   GuiQuestLines / CanvasQuestLine / PanelButtonQuest / PresetTexture / PresetColor / DirectionalLine
 * Everything is drawn into a Minecraft-style "scaled resolution" canvas so the pixel grid matches the game.
 */

(() => {
    'use strict';

    // ------------------------------------------------------------------ constants (from BQ source)
    const SIMPLE = 'textures/bq/simple_frames.png';
    const QUEST_FRAMES = 'textures/bq/quest_frames.png';
    const FONT = 'textures/font/ascii.png';

    // simple_frames.png slices + padding  (PresetTexture.registerTextures)
    const TEX = {
        panelMain: { sx: 0, sy: 0, sw: 12, sh: 12, pad: [4, 4, 4, 4] },
        panelInner: { sx: 24, sy: 0, sw: 12, sh: 12, pad: [3, 3, 3, 3] },
        auxFrame: { sx: 36, sy: 0, sw: 12, sh: 12, pad: [1, 1, 1, 1] },
        btnNormal0: { sx: 72, sy: 0, sw: 12, sh: 12, pad: [2, 2, 2, 3] },
        btnNormal1: { sx: 84, sy: 0, sw: 12, sh: 12, pad: [2, 2, 2, 3] },
        btnNormal2: { sx: 96, sy: 0, sw: 12, sh: 12, pad: [2, 2, 2, 3] },
        textBox0: { sx: 0, sy: 28, sw: 8, sh: 8, pad: [1, 1, 1, 1] },
    };

    // quest frame rows (24x24 slices, 8px padding).  state index 0..4
    //   locked, unlocked, pending, complete, repeatable
    const QUEST_ROW = { locked: 0, unlocked: 1, pending: 2, complete: 3, repeatable: 4 };
    const QUEST_COL = { norm: 0, main: 1, aux: 2 };

    // PresetColor.registerColors
    const COL = {
        textHeader: [0, 0, 0],
        textMain: [0, 0, 0],
        textAux0: [255, 255, 255],
        questIcon: {
            locked: [[128, 128, 128], [128, 128, 128], 1],
            unlocked: [[192, 0, 0], [96, 0, 0], 1],
            pending: [[0, 255, 255], [0, 128, 128], 1],
            complete: [[0, 255, 0], [0, 255, 0], 1],
            repeatable: [[255, 69, 0], [255, 96, 0], 1],
        },
    };

    // ------------------------------------------------------------------ state
    const S = {
        ready: false,
        guiW: 854, guiH: 480,
        data: null,
        imgs: new Map(),        // path -> Image
        tintCache: new Map(),   // key -> canvas
        widths: new Int32Array(256).fill(6),
        line: null,             // selected chapter id
        zoom: 1, sx: 0, sy: 0,  // quest canvas pan/zoom
        state: 'unlocked',      // quest state used for frames/lines
        hover: null,            // hovered quest (for tooltip)
        dragging: false,
        dragMoved: false,
        lastX: 0, lastY: 0,
        scroll: 0,              // chapter list scroll
        mouseX: 0, mouseY: 0,
        missing: new Set(),
    };

    const ok = i => !!i && i.complete && i.naturalWidth > 0;

    // bump to force clients past GitHub Pages' asset caching
    const V = '4';

    const canvas = document.getElementById('gui');
    const ctx = canvas.getContext('2d');
    const hud = document.getElementById('hud');

    // ------------------------------------------------------------------ loading
    function img(path) {
        if (!path) return null;
        if (S.imgs.has(path)) return S.imgs.get(path);
        const i = new Image();
        i.src = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'v=' + V;
        S.imgs.set(path, i);
        return i;
    }

    function loadWidths(text) {
        for (const line of text.split(/\r?\n/)) {
            const m = /^width\.(\d+)=(\d+)/.exec(line);
            if (m) S.widths[+m[1]] = +m[2];
        }
    }

    async function boot() {
        try {
            const [questsTxt, widthsTxt, manifestTxt] = await Promise.all([
                fetch('quests.json?v=' + V).then(r => r.text()),
                fetch('textures/font/ascii.properties?v=' + V).then(r => r.text()),
                fetch('texture_manifest.json?v=' + V).then(r => r.text()).catch(() => '{"missing":[]}'),
            ]);
            S.data = JSON.parse(questsTxt);
            for (const id of (JSON.parse(manifestTxt).missing || [])) {
                S.missing.add(id);
                S.missing.add(missKey(id));
            }
            loadWidths(widthsTxt);

            // preload the atlases + every icon we might draw
            const paths = new Set([SIMPLE, QUEST_FRAMES, FONT]);
            for (const l of Object.values(S.data.linesById)) {
                const p = l.icon && l.icon['id:8'] && iconPath(l.icon['id:8']);
                if (p) paths.add(p);
            }
            for (const q of Object.values(S.data.quests)) {
                const p = q.icon && q.icon['id:8'] && iconPath(q.icon['id:8']);
                if (p) paths.add(p);
            }
            await Promise.all([...paths].map(p => new Promise(res => {
                const i = img(p);
                if (!i || i.complete) return res();
                i.onload = i.onerror = res;
            })));

            S.ready = true;
            S.line = S.data.lines[0];
            resize();
            fit();
            requestAnimationFrame(frame);
        } catch (e) {
            const el = document.getElementById('err');
            el.style.display = 'flex';
            el.textContent = 'Failed to start:\n' + (e && e.stack || e);
        }
    }

    function iconMods() { return []; }
    // unresolved-icon lookup key: namespace is not consistently cased in the pack data
    function missKey(id) {
        const i = id.indexOf(':');
        return i < 0 ? id.toLowerCase() : id.slice(0, i).toLowerCase() + ':' + id.slice(i + 1).toLowerCase();
    }

    function iconPath(id) {
        if (!id || S.missing.has(id) || S.missing.has(missKey(id))) return null;
        const i = id.indexOf(':');
        return 'textures/icons/' + id.slice(0, i).toLowerCase() + '/' + id.slice(i + 1).toLowerCase() + '.png';
    }

    // ------------------------------------------------------------------ text (MC font, fontScale 2)
    function adv(code) { return (S.widths[code] || 6) * 2; }

    function textWidth(str) {
        let w = 0, i = 0;
        while (i < str.length) {
            const c = str.charCodeAt(i);
            if (c === 0xA7 && i + 1 < str.length) { i += 2; continue; }
            w += adv(c);
            i++;
        }
        return w;
    }

    function drawGlyph(code, x, y, colour, alpha) {
        if (code === 32) return;
        const src = img(FONT);
        if (!src.complete) return;
        const col = code % 16, row = Math.floor(code / 16);
        const cell = src.naturalWidth / 16;
        ctx.globalAlpha = alpha;
        ctx.drawImage(src, col * cell, row * cell, cell, cell, x, y, 16, 16);
        ctx.globalAlpha = 1;
    }

    const COLOURS = ['000000', '0000AA', '00AA00', '00AAAA', 'AA0000', 'AA00AA', 'FFAA00', 'AAAAAA',
        '555555', '5555FF', '55FF55', '55FFFF', 'FF5555', 'FF55FF', 'FFFF55', 'FFFFFF'];

    function drawText(str, x, y, colour, shadow) {
        let cx = x;
        let c = colour || '#000000';
        const col = c.replace('#', '');
        if (shadow) {
            const sc = shade(col);
            let sx2 = x;
            let i = 0, cs = '#3f3f3f';
            while (i < str.length) {
                const ch = str.charCodeAt(i);
                if (ch === 0xA7 && i + 1 < str.length) {
                    cs = codeColour(str[i + 1], cs);
                    i += 2;
                    continue;
                }
                drawGlyphColoured(ch, sx2 + 2, y + 2, cs);
                sx2 += adv(ch);
                i++;
            }
        }
        let i = 0;
        while (i < str.length) {
            const ch = str.charCodeAt(i);
            if (ch === 0xA7 && i + 1 < str.length) {
                c = codeColour(str[i + 1], c);
                i += 2;
                continue;
            }
            drawGlyphColoured(ch, cx, y, c);
            cx += adv(ch);
            i++;
        }
        return cx - x;
    }

    function drawGlyphColoured(code, x, y, colour) {
        if (code === 32) return;
        const src = img(FONT);
        if (!ok(src)) return;
        const col = code % 16, row = Math.floor(code / 16);
        const cell = src.naturalWidth / 16;
        const c = tintImage(src, colour);
        ctx.drawImage(c, col * cell, row * cell, cell, cell, x, y, 16, 16);
    }

    function codeColour(ch, cur) {
        if (ch === 'r' || ch === 'R') return '#3f3f3f';
        const n = parseInt(ch, 16);
        if (isNaN(n)) return cur;
        if (ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'f') return '#' + COLOURS[n];
        return cur;
    }

    function shade(hex) {
        const n = parseInt(hex, 16);
        return '#' + ((((n >> 16) & 255) >> 2) << 16 | (((n >> 8) & 255) >> 2) << 8 | ((n & 255) >> 2)).toString(16).padStart(6, '0');
    }

    // colourise a white mask sprite (MC modulate: rgb*colour, alpha kept)
    function tintImage(src, colour) {
        const key = src.src + '|' + colour;
        if (S.tintCache.has(key)) return S.tintCache.get(key);
        const c = document.createElement('canvas');
        c.width = src.naturalWidth; c.height = src.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = colour;
        g.fillRect(0, 0, c.width, c.height);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(src, 0, 0);
        S.tintCache.set(key, c);
        return c;
    }

    // ------------------------------------------------------------------ textures
    function ninePatch(t, x, y, w, h) {
        const s = img(SIMPLE);
        if (!ok(s)) return;
        const [l, tp, r, b] = t.pad;
        const sw = t.sw, sh = t.sh;
        const cw = sw - l - r, ch = sh - tp - b;
        const dw = w - l - r, dh = h - tp - b;
        const put = (sx, sy, sww, shh, dx, dy, dww, dhh) => {
            if (dww <= 0 || dhh <= 0) return;
            ctx.drawImage(s, t.sx + sx, t.sy + sy, sww, shh, x + dx, y + dy, dww, dhh);
        };
        put(0, 0, l, tp, 0, 0, l, tp);
        put(sw - r, 0, r, tp, w - r, 0, r, tp);
        put(0, sh - b, l, b, 0, h - b, l, b);
        put(sw - r, sh - b, r, b, w - r, h - b, r, b);
        put(l, 0, cw, tp, l, 0, dw, tp);
        put(l, sh - b, cw, b, l, h - b, dw, b);
        put(0, tp, l, ch, 0, tp, l, dh);
        put(sw - r, tp, r, ch, w - r, tp, r, dh);
        put(l, tp, cw, ch, l, tp, dw, dh);
    }

    function stretchTexture(sx, sy, sw, sh, x, y, w, h) {
        const s = img(QUEST_FRAMES);
        if (!ok(s)) return;
        ctx.drawImage(s, sx, sy, sw, sh, x, y, w, h);
    }

    // draw a quest frame: SLICED_STRETCH (9-patch) for norm/aux, STRETCH for main
    function questFrame(kind, stateIdx, x, y, w, h, colour) {
        const src = img(QUEST_FRAMES);
        if (!ok(src)) return;
        const sx = QUEST_COL[kind] * 24;
        const sy = stateIdx * 24;
        const sprite = tintImage(src, colour);
        if (kind === 'main') {
            ctx.drawImage(sprite, sx, sy, 24, 24, x, y, w, h);
            return;
        }
        const pad = 8, cw = 24 - pad * 2;
        const dw = Math.max(0, w - pad * 2), dh = Math.max(0, h - pad * 2);
        const put = (px, py, pw, ph, dx, dy, dww, dhh) => {
            if (dww <= 0 || dhh <= 0) return;
            ctx.drawImage(sprite, sx + px, sy + py, pw, ph, x + dx, y + dy, dww, dhh);
        };
        put(0, 0, pad, pad, 0, 0, pad, pad);
        put(24 - pad, 0, pad, pad, w - pad, 0, pad, pad);
        put(0, 24 - pad, pad, pad, 0, h - pad, pad, pad);
        put(24 - pad, 24 - pad, pad, pad, w - pad, h - pad, pad, pad);
        put(pad, 0, cw, pad, pad, 0, dw, pad);
        put(pad, 24 - pad, cw, pad, pad, h - pad, dw, pad);
        put(0, pad, pad, cw, 0, pad, pad, dh);
        put(24 - pad, pad, pad, cw, w - pad, pad, pad, dh);
        put(pad, pad, cw, cw, pad, pad, dw, dh);
    }

    // ------------------------------------------------------------------ layout
    function resize() {
        const scale = Math.max(2, Math.floor(Math.min(window.innerWidth / 320, window.innerHeight / 240)));
        S.guiW = Math.ceil(window.innerWidth / scale);
        S.guiH = Math.ceil(window.innerHeight / scale);
        canvas.width = S.guiW;
        canvas.height = S.guiH;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        ctx.imageSmoothingEnabled = false;
        fit();
    }

    const rects = () => ({
        bg: [0, 0, S.guiW, S.guiH],
        tray: [40, 24, 174, S.guiH - 32],
        frame: [214, 24, S.guiW - 222, S.guiH - 32],
    });

    // ------------------------------------------------------------------ quest canvas
    function lineQuests(lineId) {
        const line = S.data.linesById[lineId];
        const out = [];
        for (const e of line.entries) {
            const q = S.data.quests[e.id];
            if (!q) continue;
            out.push({ e, q });
        }
        return out;
    }

    function boundsOf(items) {
        if (!items.length) return { x: 0, y: 0, w: 100, h: 100 };
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const { e } of items) {
            x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y);
            x1 = Math.max(x1, e.x + e.sizeX); y1 = Math.max(y1, e.y + e.sizeY);
        }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    function fit() {
        if (!S.data || !S.line) return;
        const [, , fw, fh] = rects().frame;
        const b = boundsOf(lineQuests(S.line));
        const m = 24;
        const z = Math.min((fw - m * 2) / b.w, (fh - m * 2) / b.h);
        S.zoom = Math.max(0.25, Math.min(2, z));
        S.sx = b.x - (fw / S.zoom - b.w) / 2;
        S.sy = b.y - (fh / S.zoom - b.h) / 2;
    }

    const toScreen = (x, y) => {
        const [fx, fy] = rects().frame;
        return [fx + (x - S.sx) * S.zoom, fy + (y - S.sy) * S.zoom];
    };
    const toWorld = (x, y) => {
        const [fx, fy] = rects().frame;
        return [(x - fx) / S.zoom + S.sx, (y - fy) / S.zoom + S.sy];
    };

    // ------------------------------------------------------------------ render
    function frame() {
        const now = performance.now();
        ctx.clearRect(0, 0, S.guiW, S.guiH);
        if (S.ready) render(now);
        requestAnimationFrame(frame);
    }

    function pulse(from, to) {
        const t = (Math.sin(performance.now() / 500) + 1) / 2;
        return [
            Math.round(from[0] + (to[0] - from[0]) * t),
            Math.round(from[1] + (to[1] - from[1]) * t),
            Math.round(from[2] + (to[2] - from[2]) * t),
        ];
    }

    function stateColour(state) {
        const d = COL.questIcon[state];
        return pulse(d[0], d[1]);
    }

    const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

    function render(now) {
        const { bg, tray, frame: fr } = rects();
        const line = S.data.linesById[S.line];

        // background panel
        ninePatch(TEX.panelMain, ...bg);

        // chapter tray
        ninePatch(TEX.panelInner, tray[0], tray[1], tray[2], tray[3]);
        renderChapterList(tray);

        // quest frame + canvas
        ninePatch(TEX.auxFrame, fr[0], fr[1], fr[2], fr[3]);
        ctx.save();
        ctx.beginPath();
        ctx.rect(fr[0], fr[1], fr[2], fr[3]);
        ctx.clip();
        renderQuestCanvas(line, fr);
        ctx.restore();

        // chapter header: icon at (40,8) + title at (60,12)   [GuiQuestLines.icoChapter / txTitle]
        if (line && line.icon && line.icon['id:8']) {
            const p = img(iconPath(line.icon['id:8']));
            if (ok(p)) ctx.drawImage(p, 40, 8, 16, 16);
        }
        drawText(line ? line.name : '', 60, 12, '#000000', false);

        // hover tooltip
        if (S.hover && !S.dragging) renderTooltip(S.hover, S.mouseX, S.mouseY);

        hud.textContent = `${line ? line.name : ''}  ·  state: ${S.state}  ·  zoom ${S.zoom.toFixed(2)}  ·  drag=pan  wheel=zoom  F=fit  S=state`;
    }

    function renderChapterList(tray) {
        const [tx, ty, tw, th] = tray;
        const listX = tx + 8, listY = ty + 20, listW = tw - 8 - 16, listH = th - 20 - 8;

        let y = listY - S.scroll;
        for (const id of S.data.lines) {
            const l = S.data.linesById[id];
            if (y + 16 < listY - 16 || y > listY + listH) { y += 16; continue; }
            const selected = id === S.line;
            const hovered = S.mouseX >= listX && S.mouseX < listX + listW && S.mouseY >= y && S.mouseY < y + 16;
            if (hovered && y >= listY && y + 16 <= listY + listH) {
                ctx.fillStyle = 'rgba(255,255,255,0.18)';
                ctx.fillRect(listX, y, listW, 16);
            }
            // chapter icon
            if (l.icon && l.icon['id:8']) {
                const p = img(iconPath(l.icon['id:8']));
                if (ok(p)) ctx.drawImage(p, listX, y, 16, 16);
            }
            drawText(l.name, listX + 18, y + 4, selected ? '#000000' : '#1a1a1a', false);
            y += 16;
        }

        // scrollbar
        const total = S.data.lines.length * 16;
        if (total > listH) {
            const barH = Math.max(12, listH * listH / total);
            const barY = listY + (listH - barH) * (S.scroll / Math.max(1, total - listH));
            ninePatch(TEX.panelInner, listX + listW + 4, listY, 8, listH);
            ctx.fillStyle = 'rgba(120,120,120,0.9)';
            ctx.fillRect(listX + listW + 4, barY, 8, barH);
        }
    }

    function renderQuestCanvas(line, fr) {
        if (!line) return;
        const [fx, fy, fw, fh] = fr;
        const items = lineQuests(S.line);
        const byId = new Map(items.map(it => [it.e.id, it]));

        const centre = it => {
            const [x, y] = toScreen(it.e.x + it.e.sizeX / 2, it.e.y + it.e.sizeY / 2);
            return [x, y];
        };

        // dependency lines (only where both ends live in this chapter, matching BQ)
        for (const it of items) {
            for (const pid of it.q.prerequisites) {
                const par = byId.get(pid);
                if (!par) continue;
                const col = stateColour(S.state);
                const main = it.q.isMain === 1;
                drawDependency(centre(par), centre(it), (main ? 8 : 4) * S.zoom, col);
            }
        }

        // quest buttons
        S.hover = null;
        for (const it of items) {
            const [x, y] = toScreen(it.e.x, it.e.y);
            const w = it.e.sizeX * S.zoom, h = it.e.sizeY * S.zoom;
            if (x + w < fx || x > fx + fw || y + h < fy || y > fy + fh) continue;

            const kind = it.q.isMain === 1 ? 'main' : 'norm';
            questFrame(kind, QUEST_ROW[S.state], x, y, w, h, rgb(stateColour(S.state)));

            // icon, centred, isz = min(w - 8, h - 8)
            const pad = 4 * 2 * S.zoom;
            const isz = Math.max(4, Math.min(w - pad, h - pad));
            const id = it.q.icon && it.q.icon['id:8'];
            const p = id ? img(iconPath(id)) : null;
            if (ok(p)) {
                ctx.drawImage(p, x + (w - isz) / 2, y + (h - isz) / 2, isz, isz);
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.25)';
                ctx.fillRect(x + (w - isz) / 2, y + (h - isz) / 2, isz, isz);
            }

            if (S.mouseX >= x && S.mouseX < x + w && S.mouseY >= y && S.mouseY < y + h) S.hover = it;
        }
    }

    // DirectionalLine: a quad along the segment plus arrow heads every ~20px
    function drawDependency(a, b, width, colour) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len <= 0) return;
        const cos = dx / len, sin = dy / len;
        const hw = width / 2;

        ctx.save();
        ctx.translate(a[0], a[1]);
        ctx.rotate(Math.atan2(sin, cos));
        ctx.fillStyle = `rgba(${colour[0]},${colour[1]},${colour[2]},1)`;
        ctx.fillRect(0, -hw, len, width);

        // arrow heads
        const arrowOpacity = 0.2;
        ctx.fillStyle = `rgba(0,0,0,${arrowOpacity})`;
        const n = Math.ceil(len / (20 * S.zoom)) || 1;
        const arrowSize = width * 0.75, arrowWidth = width * 0.5;
        const offset = n % 2 === 1 ? 0 : (1 / (n + 1)) / 2;
        for (let i = 0; i <= n; i++) {
            const prog = i / (n + 1) + offset;
            const ax = len * prog;
            ctx.beginPath();
            ctx.moveTo(ax - arrowWidth / 2, -hw);
            ctx.lineTo(ax + arrowWidth / 2, -hw);
            ctx.lineTo(ax + arrowSize + arrowWidth / 2, 0);
            ctx.lineTo(ax + arrowSize - arrowWidth / 2, 0);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(ax - arrowWidth / 2, hw);
            ctx.lineTo(ax + arrowSize - arrowWidth / 2, 0);
            ctx.lineTo(ax + arrowSize + arrowWidth / 2, 0);
            ctx.lineTo(ax + arrowWidth / 2, hw);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    function renderTooltip(it, mx, my) {
        const q = it.q;
        const lines = [q.name];
        const inLine = lineQuests(S.line).length;
        lines.push(`${q.tasks.length} task(s)`);
        if (q.prerequisites.length) {
            lines.push('Requires:');
            for (const p of q.prerequisites) {
                const pq = S.data.quests[p];
                if (pq) lines.push('- ' + pq.name);
            }
        }

        let w = 0;
        for (const l of lines) w = Math.max(w, textWidth(l));
        const pad = 4, lh = 20;
        const h = lines.length * lh + 4;
        let x = mx + 12, y = my - 12;
        if (x + w + pad * 2 > S.guiW) x = mx - w - pad * 2 - 12;
        if (y + h > S.guiH) y = Math.max(2, S.guiH - h - 2);

        ctx.fillStyle = 'rgba(16,0,16,0.94)';
        ctx.fillRect(x - 3, y - 3, w + pad * 2, h + pad);
        ctx.strokeStyle = '#5000ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 2.5, y - 2.5, w + pad * 2 - 1, h + pad - 1);

        drawText(lines[0], x + 1, y + 2, '#ffffff', true);
        for (let i = 1; i < lines.length; i++) {
            drawText(lines[i], x + 1, y + 2 + i * lh, '#a0a0a0', true);
        }
    }

    // ------------------------------------------------------------------ interaction
    function bind() {
        window.addEventListener('resize', resize);

        canvas.addEventListener('mousemove', e => {
            const r = canvas.getBoundingClientRect();
            S.mouseX = (e.clientX - r.left) * S.guiW / r.width;
            S.mouseY = (e.clientY - r.top) * S.guiH / r.height;
            if (S.dragging) {
                S.sx -= (e.movementX) * S.guiW / r.width / S.zoom;
                S.sy -= (e.movementY) * S.guiH / r.height / S.zoom;
                S.dragMoved = true;
                canvas.classList.add('dragging');
            }
        });

        canvas.addEventListener('mousedown', e => {
            const { tray } = rects();
            const [fx, fy, fw, fh] = rects().frame;
            const listX = tray[0] + 8, listY = tray[1] + 20, listW = tray[2] - 24;

            if (S.mouseX >= fx && S.mouseX < fx + fw && S.mouseY >= fy && S.mouseY < fy + fh) {
                S.dragging = true;
                S.dragMoved = false;
                return;
            }
            // chapter list: select on click
            if (S.mouseX >= listX && S.mouseX < listX + listW && S.mouseY >= listY) {
                const idx = Math.floor((S.mouseY - listY + S.scroll) / 16);
                if (idx >= 0 && idx < S.data.lines.length) {
                    S.line = S.data.lines[idx];
                    fit();
                }
            }
        });

        window.addEventListener('mouseup', () => {
            S.dragging = false;
            canvas.classList.remove('dragging');
        });

        // chapter list scrolling
        canvas.addEventListener('wheel', e => {
            const { tray } = rects();
            const listX = tray[0] + 8, listY = tray[1] + 20, listW = tray[2] - 24, listH = tray[3] - 28;
            if (S.mouseX >= listX && S.mouseX < listX + listW && S.mouseY >= listY && S.mouseY < listY + listH) {
                const max = Math.max(0, S.data.lines.length * 16 - listH);
                S.scroll = Math.max(0, Math.min(max, S.scroll + e.deltaY));
                e.preventDefault();
                e.stopPropagation();
            }
        }, { passive: false });

        canvas.addEventListener('wheel', e => {
            const [fx, fy, fw, fh] = rects().frame;
            if (S.mouseX < fx || S.mouseX >= fx + fw || S.mouseY < fy || S.mouseY >= fy + fh) return;
            e.preventDefault();
            const before = toWorld(S.mouseX, S.mouseY);
            const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            S.zoom = Math.max(0.25, Math.min(4, S.zoom * f));
            const after = toWorld(S.mouseX, S.mouseY);
            S.sx += before[0] - after[0];
            S.sy += before[1] - after[1];
        }, { passive: false });

        window.addEventListener('keydown', e => {
            if (e.key === 'f' || e.key === 'F') fit();
            if (e.key === 's' || e.key === 'S') {
                const order = ['locked', 'unlocked', 'pending', 'complete', 'repeatable'];
                S.state = order[(order.indexOf(S.state) + 1) % order.length];
            }
        });
    }

    bind();
    boot();
})();
