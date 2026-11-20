// Document scanner for the EC8A result sheet: find the sheet in the photo, straighten it (perspective correction),
// remove shadows and boost contrast so the figures are clearly readable, preview, then hand back a clean JPEG.
// No library: runs on the phone, loaded only when an observer takes an EC8A photo.
//   const blob = await DocScan.open(file);   // Blob (scan or original) · null = cancelled
(() => {
  const MAXW = 2200; // longest side of the finished scan
  const $c = (t, css, html) => {
    const e = document.createElement(t);
    if (css) e.style.cssText = css;
    if (html) e.innerHTML = html;
    return e;
  };

  // ---- load the photo upright (honours the camera's rotation flag) ----
  async function load(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return await new Promise((ok, no) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => no(new Error("Could not read that photo"));
        i.src = URL.createObjectURL(file);
      });
    }
  }
  const toCanvas = (img, max) => {
    const w = img.width || img.naturalWidth,
      h = img.height || img.naturalHeight,
      k = Math.min(1, max / Math.max(w, h)),
      c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  };
  const rotate90 = (src) => {
    const c = document.createElement("canvas");
    c.width = src.height;
    c.height = src.width;
    const x = c.getContext("2d");
    x.translate(c.width, 0);
    x.rotate(Math.PI / 2);
    x.drawImage(src, 0, 0);
    return c;
  };

  // ---- find the sheet: the biggest bright region (paper) on a dark-ish background ----
  function detect(src) {
    const W = 160,
      H = Math.max(1, Math.round((160 * src.height) / src.width)),
      s = document.createElement("canvas");
    s.width = W;
    s.height = H;
    const x = s.getContext("2d", { willReadFrequently: true });
    x.drawImage(src, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data,
      g = new Float32Array(W * H),
      hist = new Array(256).fill(0);
    for (let i = 0; i < W * H; i++) {
      const v = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
      g[i] = v;
      hist[v]++;
    }
    // Otsu: the brightness that best separates paper from background
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0,
      sB = 0,
      best = 0,
      th = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = W * H - wB;
      if (!wF) break;
      sB += t * hist[t];
      const mB = sB / wB,
        mF = (sum - sB) / wF,
        v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) {
        best = v;
        th = t;
      }
    }
    // largest connected bright component (flood fill on the small grid)
    const mask = new Uint8Array(W * H),
      lab = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = g[i] > th ? 1 : 0;
    let bestLab = 0,
      bestN = 0,
      L = 0;
    const stack = [];
    for (let i = 0; i < W * H; i++) {
      if (!mask[i] || lab[i]) continue;
      L++;
      let n = 0;
      stack.push(i);
      lab[i] = L;
      while (stack.length) {
        const p = stack.pop();
        n++;
        const px = p % W,
          py = (p / W) | 0;
        for (const q of [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1])
          if (q >= 0 && mask[q] && !lab[q]) {
            lab[q] = L;
            stack.push(q);
          }
      }
      if (n > bestN) {
        bestN = n;
        bestLab = L;
      }
    }
    const kx = src.width / W,
      ky = src.height / H,
      inset = (m) => [[m, m], [src.width - m, m], [src.width - m, src.height - m], [m, src.height - m]].map(([a, b]) => ({ x: a, y: b })),
      fallback = inset(Math.min(src.width, src.height) * 0.06);
    if (bestN < W * H * 0.15) return fallback;
    // corners of that region: the extreme points along the two diagonals
    let tl = null, tr = null, br = null, bl = null;
    for (let i = 0; i < W * H; i++) {
      if (lab[i] != bestLab) continue;
      const px = i % W,
        py = (i / W) | 0,
        a = px + py,
        b = px - py;
      if (!tl || a < tl.a) tl = { a, px, py };
      if (!br || a > br.a) br = { a, px, py };
      if (!tr || b > tr.b) tr = { b, px, py };
      if (!bl || b < bl.b) bl = { b, px, py };
    }
    const q = [tl, tr, br, bl].map((p) => ({ x: (p.px + 0.5) * kx, y: (p.py + 0.5) * ky }));
    // a sheet that fills nearly the whole frame, or a degenerate shape, falls back to a sensible inset
    const area = Math.abs((q[0].x * q[1].y - q[1].x * q[0].y + q[1].x * q[2].y - q[2].x * q[1].y + q[2].x * q[3].y - q[3].x * q[2].y + q[3].x * q[0].y - q[0].x * q[3].y) / 2);
    return area < src.width * src.height * 0.12 ? fallback : q;
  }

  // ---- perspective warp: map the 4 corners onto a flat rectangle ----
  function homography(src, dst) {
    // solve for h (8 unknowns) with dst -> src mapping
    const A = [],
      B = [];
    for (let i = 0; i < 4; i++) {
      const { x: X, y: Y } = dst[i],
        { x, y } = src[i];
      A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]);
      B.push(x);
      A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]);
      B.push(y);
    }
    for (let i = 0; i < 8; i++) {
      let p = i;
      for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]];
      [B[i], B[p]] = [B[p], B[i]];
      for (let r = i + 1; r < 8; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < 8; c++) A[r][c] -= f * A[i][c];
        B[r] -= f * B[i];
      }
    }
    const h = new Array(8);
    for (let i = 7; i >= 0; i--) {
      let s = B[i];
      for (let c = i + 1; c < 8; c++) s -= A[i][c] * h[c];
      h[i] = s / A[i][i];
    }
    return h;
  }
  function warp(src, q) {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])),
      h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const k = Math.min(1, MAXW / Math.max(w, h));
    w = Math.max(50, Math.round(w * k));
    h = Math.max(50, Math.round(h * k));
    const H = homography(q, [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]),
      sx = src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, src.width, src.height),
      sd = sx.data,
      out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ox = out.getContext("2d"),
      od = ox.createImageData(w, h),
      o = od.data,
      SW = src.width,
      SH = src.height;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const den = H[6] * x + H[7] * y + 1,
          u = (H[0] * x + H[1] * y + H[2]) / den,
          v = (H[3] * x + H[4] * y + H[5]) / den,
          i = (y * w + x) * 4;
        if (u < 0 || v < 0 || u >= SW - 1 || v >= SH - 1) {
          o[i] = o[i + 1] = o[i + 2] = 255;
          o[i + 3] = 255;
          continue;
        }
        const x0 = u | 0,
          y0 = v | 0,
          fx = u - x0,
          fy = v - y0,
          p = (y0 * SW + x0) * 4,
          p2 = p + SW * 4;
        for (let c = 0; c < 3; c++) {
          const a = sd[p + c] * (1 - fx) + sd[p + 4 + c] * fx,
            b = sd[p2 + c] * (1 - fx) + sd[p2 + 4 + c] * fx;
          o[i + c] = a * (1 - fy) + b * fy;
        }
        o[i + 3] = 255;
      }
    ox.putImageData(od, 0, 0);
    return out;
  }

  // ---- clean-up: flatten uneven light and shadows, whiten the paper, darken the ink ----
  function boxBlur(a, w, h, r) {
    const t = new Float32Array(w * h),
      o = new Float32Array(w * h),
      n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        t[y * w + x] = s / n;
        s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        o[y * w + x] = s / n;
        s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x];
      }
    }
    return o;
  }
  function enhance(src, mode) {
    if (mode == "color") return src;
    const w = src.width,
      h = src.height,
      x = src.getContext("2d", { willReadFrequently: true }),
      id = x.getImageData(0, 0, w, h),
      d = id.data,
      // the paper's own brightness, estimated on a small copy (text is too thin to survive the blur) and scaled back up
      sw = Math.max(8, Math.round(w / 8)),
      sh = Math.max(8, Math.round(h / 8)),
      sm = document.createElement("canvas");
    sm.width = sw;
    sm.height = sh;
    sm.getContext("2d").drawImage(src, 0, 0, sw, sh);
    const sd = sm.getContext("2d").getImageData(0, 0, sw, sh).data,
      lum = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) lum[i] = sd[i * 4] * 0.299 + sd[i * 4 + 1] * 0.587 + sd[i * 4 + 2] * 0.114;
    // paper = the bright end: a max-ish filter (dilate by blurring the brightest values), so ink does not drag the estimate down
    const bright = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++)
      for (let xx = 0; xx < sw; xx++) {
        let m = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) m = Math.max(m, lum[Math.min(sh - 1, Math.max(0, y + dy)) * sw + Math.min(sw - 1, Math.max(0, xx + dx))]);
        bright[y * sw + xx] = m;
      }
    const bg = boxBlur(bright, sw, sh, 4);
    for (let y = 0; y < h; y++)
      for (let xx = 0; xx < w; xx++) {
        const fx = Math.min(sw - 1.001, (xx / w) * sw),
          fy = Math.min(sh - 1.001, (y / h) * sh),
          x0 = fx | 0,
          y0 = fy | 0,
          ax = fx - x0,
          ay = fy - y0,
          b = (bg[y0 * sw + x0] * (1 - ax) + bg[y0 * sw + x0 + 1] * ax) * (1 - ay) + (bg[(y0 + 1) * sw + x0] * (1 - ax) + bg[(y0 + 1) * sw + x0 + 1] * ax) * ay,
          k = 255 / Math.max(60, b),
          i = (y * w + xx) * 4;
        if (mode == "bw") {
          const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * k,
            t = Math.max(0, Math.min(255, ((v - 120) / (205 - 120)) * 255));
          d[i] = d[i + 1] = d[i + 2] = t;
        } else {
          // "clear": keep colour (stamps, pen colours), whiten the paper, add a little contrast
          for (let c = 0; c < 3; c++) {
            const v = Math.min(255, d[i + c] * k),
              t = 255 * Math.pow(v / 255, 1.35);
            d[i + c] = Math.max(0, Math.min(255, (t - 128) * 1.12 + 128 + 12));
          }
        }
      }
    x.putImageData(id, 0, 0);
    // light unsharp mask: crisper digits
    return sharpen(src);
  }
  function sharpen(c) {
    const w = c.width,
      h = c.height,
      x = c.getContext("2d", { willReadFrequently: true }),
      id = x.getImageData(0, 0, w, h),
      d = id.data,
      o = new Uint8ClampedArray(d);
    for (let y = 1; y < h - 1; y++)
      for (let xx = 1; xx < w - 1; xx++) {
        const i = (y * w + xx) * 4;
        for (let k = 0; k < 3; k++) o[i + k] = Math.max(0, Math.min(255, d[i + k] * 1.6 - 0.15 * (d[i - 4 + k] + d[i + 4 + k] + d[i - w * 4 + k] + d[i + w * 4 + k]) - 0.0));
      }
    id.data.set(o);
    x.putImageData(id, 0, 0);
    return c;
  }
  const blob = (c, q) => new Promise((r) => c.toBlob(r, "image/jpeg", q || 0.88));

  // ---- the screen: photo with 4 draggable corners, mode buttons, use / retake ----
  function open(file) {
    return new Promise(async (done) => {
      let img;
      try {
        img = await load(file);
      } catch (e) {
        return done(file); // cannot decode: upload the photo as it is
      }
      let base = toCanvas(img, 2400), // working copy of the photo
        q = detect(base),
        mode = "clear",
        result = null;
      const w = $c("div", "position:fixed;inset:0;background:#0b1220;z-index:20000;display:flex;flex-direction:column;color:#fff;font-family:system-ui,sans-serif");
      const bar = $c("div", "display:flex;gap:6px;flex-wrap:wrap;padding:8px;justify-content:center;background:#111b2e");
      const stage = $c("div", "position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none");
      const view = $c("canvas", "max-width:100%;max-height:100%;display:block");
      stage.appendChild(view);
      const foot = $c("div", "display:flex;gap:8px;padding:10px;justify-content:center;background:#111b2e");
      const btn = (t, css, f) => {
        const b = $c("button", "border:0;border-radius:10px;padding:10px 14px;font-size:14px;font-weight:600;" + css, t);
        b.onclick = f;
        return b;
      };
      const ghost = "background:#26344f;color:#fff";
      const hint = $c("div", "text-align:center;font-size:12px;color:#a0aec0;padding:4px 8px", "Drag the 4 corners onto the corners of the sheet, then tap Scan.");
      const handles = [0, 1, 2, 3].map((i) => {
        const hd = $c("div", "position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(246,173,85,.35);border:3px solid #f6ad55;touch-action:none");
        stage.appendChild(hd);
        hd.onpointerdown = (e) => {
          hd.setPointerCapture(e.pointerId);
          const mv = (ev) => {
            const r = view.getBoundingClientRect();
            q[i] = { x: Math.max(0, Math.min(base.width, ((ev.clientX - r.left) / r.width) * base.width)), y: Math.max(0, Math.min(base.height, ((ev.clientY - r.top) / r.height) * base.height)) };
            draw();
          };
          hd.onpointermove = mv;
          hd.onpointerup = () => {
            hd.onpointermove = hd.onpointerup = null;
          };
        };
        return hd;
      });
      function place() {
        const r = view.getBoundingClientRect(),
          s = stage.getBoundingClientRect();
        handles.forEach((hd, i) => {
          hd.style.display = result ? "none" : "";
          hd.style.left = r.left - s.left + (q[i].x / base.width) * r.width + "px";
          hd.style.top = r.top - s.top + (q[i].y / base.height) * r.height + "px";
        });
      }
      function draw() {
        const src = result || base;
        view.width = src.width;
        view.height = src.height;
        const x = view.getContext("2d");
        x.drawImage(src, 0, 0);
        if (!result) {
          x.lineWidth = Math.max(3, base.width / 300);
          x.strokeStyle = "#f6ad55";
          x.beginPath();
          q.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
          x.closePath();
          x.stroke();
        }
        requestAnimationFrame(place);
      }
      let scanBtn, modeBar;
      function scan() {
        const flat = warp(base, q);
        result = enhance(flat, mode);
        // keep the flat version so modes can be switched without redoing the warp
        result._flat = flat;
        hint.textContent = "Check the figures are clear. Change the look, adjust, or use it.";
        syncUI();
        draw();
      }
      function setMode(m) {
        mode = m;
        if (result) {
          const flat = result._flat;
          // enhance works on a copy so the flat original stays untouched
          const cp = document.createElement("canvas");
          cp.width = flat.width;
          cp.height = flat.height;
          cp.getContext("2d").drawImage(flat, 0, 0);
          result = enhance(cp, mode);
          result._flat = flat;
          draw();
        }
        syncUI();
      }
      function syncUI() {
        scanBtn.style.display = result ? "none" : "";
        useBtn.style.display = result ? "" : "none";
        adjBtn.style.display = result ? "" : "none";
        modeBar.querySelectorAll("button").forEach((b) => (b.style.outline = b.dataset.m == mode ? "2px solid #f6ad55" : "none"));
      }
      const close = (v) => {
        w.remove();
        done(v);
      };
      modeBar = $c("div", "display:flex;gap:6px");
      [["clear", "Clear"], ["bw", "Black & white"], ["color", "Original colour"]].forEach(([m, t]) => {
        const b = btn(t, ghost, () => setMode(m));
        b.dataset.m = m;
        modeBar.appendChild(b);
      });
      bar.append(
        btn("↻ Rotate", ghost, () => {
          base = rotate90(base);
          q = detect(base);
          result = null;
          syncUI();
          draw();
        }),
        btn("✨ Auto-find sheet", ghost, () => {
          q = detect(base);
          result = null;
          syncUI();
          draw();
        }),
        modeBar,
      );
      scanBtn = btn("📄 Scan", "background:#38a169;color:#fff;flex:2", scan);
      const useBtn = btn("✓ Use this scan", "background:#38a169;color:#fff;flex:2", async () => {
        useBtn.disabled = true;
        useBtn.textContent = "Saving…";
        close(await blob(result, 0.88));
      });
      const adjBtn = btn("Adjust corners", ghost, () => {
        result = null;
        hint.textContent = "Drag the 4 corners onto the corners of the sheet, then tap Scan.";
        syncUI();
        draw();
      });
      foot.append(
        btn("✕ Cancel", "background:#742a2a;color:#fff", () => close(null)),
        btn("Use original", ghost, () => close(file)),
        adjBtn,
        scanBtn,
        useBtn,
      );
      w.append(bar, hint, stage, foot);
      document.body.appendChild(w);
      window.addEventListener("resize", place);
      syncUI();
      draw();
    });
  }
  window.DocScan = { open, _t: { detect, warp, enhance, homography, toCanvas } };
})();
