// API base: "" on the web; the Android app sets window.MCC_BASE to the Command Center address
const BASE = String(window.MCC_BASE || "").replace(/\/$/, "");
const $ = (s) => document.querySelector(s),
  esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";"),
  TM = (t) => new Date(t).toLocaleTimeString(),
  DT = (t) => new Date(t).toLocaleString();
let tt;
function toast(m) {
  const t = $("#toast");
  t.textContent = m;
  t.classList.add("show");
  clearTimeout(tt);
  tt = setTimeout(() => t.classList.remove("show"), 3500);
}
const A = {
  pcs: {},
  get tok() {
    return sessionStorage.getItem("t");
  },
  async f(p, o = {}) {
    const h = { ...(A.tok ? { Authorization: "Bearer " + A.tok } : {}), ...(o.headers || {}) };
    let b = o.body;
    if (b && typeof b == "object" && !(b instanceof Blob) && !(b instanceof ArrayBuffer)) {
      b = JSON.stringify(b);
      h["Content-Type"] = "application/json";
    }
    const r = await fetch(BASE + "/api/" + p, { method: o.method || (b ? "POST" : "GET"), headers: h, body: b });
    const j = (r.headers.get("content-type") || "").includes("json") ? await r.json() : await r.blob();
    if (r.status == 401 && A.tok && !p.startsWith("login")) {
      logout();
      throw new Error("Session ended");
    }
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  },
  get: (p) => A.f(p),
  post: (p, b) => A.f(p, { method: "POST", body: b || {} }),
  del: (p) => A.f(p, { method: "DELETE" }),
  async dl(p, name) {
    const b = await A.get(p);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
  },
  ws(on) {
    const open = () => {
      const s = new WebSocket(
        (BASE ? BASE.replace(/^http/, "ws") : (location.protocol == "https:" ? "wss://" : "ws://") + location.host) + "/ws?t=" + A.tok,
      );
      A.sock = s;
      s.onmessage = (e) => on(JSON.parse(e.data));
      s.onclose = () => A.tok && setTimeout(open, 2000);
    };
    open();
  },
  send(o) {
    A.sock?.readyState == 1 && A.sock.send(JSON.stringify(o));
  },
  async sig(m) {
    const pc = A.pcs[m.code];
    if (m.type == "answer" && pc) await pc.setRemoteDescription(m.sdp);
    if (m.type == "ice" && pc) pc.addIceCandidate(m.cand).catch(() => {});
    if (m.type == "nostream") toast("Observer is not streaming right now.");
  },
  async lkWatch(code, el, talk) {
    const { Room, RoomEvent, Track } = LivekitClient,
      r = await A.post("livekit/token", { code }),
      room = new Room({ adaptiveStream: true, dynacast: true });
    room.on(RoomEvent.TrackSubscribed, (t) => {
      if (t.kind == Track.Kind.Video || t.kind == Track.Kind.Audio) t.attach(el);
    });
    await room.connect(r.url, r.token);
    room.startAudio().catch(() => {}); // make sure the observer's sound plays, not only the picture
    A.pcs[code] = { close: () => room.disconnect() };
    if (talk)
      await room.localParticipant
        .setMicrophoneEnabled(true)
        .catch(() => toast("Microphone unavailable — listen only"));
    if (!room.remoteParticipants.size) toast("Connected — waiting for the observer to start streaming…");
  },
  async watch(code, el, talk) {
    A.unwatch(code);
    if (CFG.lk) return A.lkWatch(code, el, talk);
    const pc = new RTCPeerConnection({ iceServers: CFG.ice });
    let mic = null;
    pc.addTransceiver("video", { direction: "recvonly" });
    if (talk) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getTracks().forEach((t) => pc.addTrack(t, mic));
        pc.mic = mic;
      } catch {
        toast("Microphone unavailable — listen only");
      }
    }
    if (!mic) pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (e) => {
      el.srcObject = e.streams[0];
      el.play().catch(() => {});
    };
    pc.onicecandidate = (e) => e.candidate && A.send({ type: "ice", code, cand: e.candidate });
    A.pcs[code] = pc;
    await pc.setLocalDescription(await pc.createOffer());
    A.send({ type: "offer", code, sdp: pc.localDescription });
  },
  unwatch(code) {
    const pc = A.pcs[code];
    if (pc) {
      pc.mic?.getTracks().forEach((t) => t.stop());
      pc.close();
      delete A.pcs[code];
    }
  },
};
function logout() {
  sessionStorage.removeItem("t");
  Object.keys(A.pcs).forEach(A.unwatch);
  location.reload();
}
// ---------- state ----------
let CFG,
  ME,
  TABS = {},
  TAB = null,
  F = {},
  SEL = null,
  DRILL = null,
  LVL = "nat",
  MS = null,
  fit = true,
  NEWPASS = null;
const DATA = {
  obs: [],
  inc: [],
  msg: [],
  con: [],
  units: [],
  rooms: [],
  radio: [],
  clips: [],
  aud: [],
  bc: [],
  set: {},
  cu: [],
  tn: [],
};
const PCOL = [
  "#2b6cb0",
  "#e53e3e",
  "#38a169",
  "#d69e2e",
  "#805ad5",
  "#dd6b20",
  "#319795",
  "#b83280",
  "#718096",
  "#2d3748",
];
const st = (o) => {
  const a = Date.now() - (o.seen ? new Date(o.seen) : 0);
  return !o.seen ? "Offline" : a < 30000 ? "Live" : a < 300000 ? "Idle" : "Offline";
};
const pill = (s) =>
  `<span class="pill ${{ Live: "g", Idle: "a", Offline: "s", active: "g", inactive: "s", suspended: "a", Online: "g" }[s] || "s"}">${s}</span>`;
const tot = (o) => Object.values(o.t || {}).reduce((a, x) => a + x.v, 0),
  anom = (o) => tot(o) > o.reg;
const hav = (a, b, c, d) => {
  const r = Math.PI / 180,
    x =
      Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};
// ---- collation (computed on the server: reconciles the 2 observers per PU) ----
const COLL_KEYS = ["state", "lga", "ward", "pu", "room"];
let CR = null; // room id when Command drills into one room
let POOLED = true; // Global Collation: whole state (all pooled Command Centers) or this Command Center only
const poolOn = () => POOLED && !F.room && (A.role == "cmd" ? TAB == "col" && (!!ME.tenantState || !!ME.su) : A.role == "room");
const collKey = () => JSON.stringify([LVL, poolOn(), ...COLL_KEYS.map((k) => (k == "room" ? F.room || CR || "" : F[k] || ""))]);
async function loadColl() {
  const k = collKey(),
    p = new URLSearchParams({ level: LVL });
  COLL_KEYS.forEach((x) => (x == "room" ? F.room || CR : F[x]) && p.set(x, x == "room" ? F.room || CR : F[x]));
  if (poolOn()) p.set("pool", "1");
  DATA.collKey = k;
  try {
    DATA.coll = await A.get("collation?" + p);
  } catch (e) {
    DATA.coll = { error: e.message };
  }
  refresh();
}
const SC = {
  verified: ["g", "Verified (EC8A)"],
  matched: ["g", "Matched"],
  resolved: ["b", "Resolved"],
  single: ["a", "Single observer"],
  partial: ["a", "Entering"],
  disputed: ["r", "Disputed"],
  pending: ["s", "Pending"],
  anomaly: ["r", "Over reg. voters"],
};
// parties ordered by votes collated, highest first (ties keep ballot order) - re-sorts live
const byVotes = (ps, t) =>
  ps
    .map((p, i) => [p, i])
    .sort((a, b) => (t[b[0]] || 0) - (t[a[0]] || 0) || a[1] - b[1])
    .map((x) => x[0]);
const pillS = (k, n) => `<span class="pill ${SC[k][0]}">${SC[k][1]}${n != null ? " · " + n : ""}</span>`;
function hist() {
  const c = DATA.coll;
  if (!c) return '<div class="muted">Loading collation…</div>';
  if (c.error) return '<div class="muted">⚠️ ' + esc(c.error) + "</div>";
  const s = c.sum,
    n = s.counts,
    show = byVotes(c.parties, s.totals).filter((p, i) => (PF() ? p == PF() : i < 10 || s.totals[p] > 0));
  return (
    `<div class="muted" style="margin-bottom:8px">${n.verified}/${n.pus} PUs verified · ${s.total.toLocaleString()} votes counted · ${n.disputed} disputed (not counted until resolved)${PF() ? " · showing <b>" + PF() + "</b> only" : ""}</div>${c.pooled ? `<div class="muted" style="margin-bottom:8px;background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;padding:8px 10px"><i class="fas fa-layer-group"></i> <b>${c.pooled.all ? "All states · platform-wide" : c.pooled.lga ? esc(c.pooled.lga.split(",").join(", ")) + (c.pooled.lga.includes(",") ? " zone-wide" : " LGA-wide") : esc(c.pooled.state) + " state-wide"}</b>: vote counts from ${c.pooled.lga ? "every Situation Room covering " + (c.pooled.lga.includes(",") ? "these LGAs" : "this LGA") + ", across " : ""}${c.pooled.centres} Command Center${c.pooled.centres == 1 ? "" : "s"}. ${c.pooled.extPus ? `<b>${c.pooled.extPus}</b> polling unit${c.pooled.extPus == 1 ? "" : "s"} (<b>${c.pooled.extVotes.toLocaleString()}</b> votes) come from <b>external observers</b> — observers of other ${c.pooled.lga ? "Situation Rooms and " : ""}Command Centers. Vote counts only: their map, video, audio and observer details are not shared.` : "No figures from external observers yet."}</div>` : ""}<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${Object.keys(SC)
      .filter((k) => n[k])
      .map((k) => pillS(k, n[k]))
      .join("")}</div>` +
    show
      .map((p) => {
        const i = c.parties.indexOf(p),
          pc = s.total ? Math.round((s.totals[p] / s.total) * 100) : 0;
        return `<div class="histogram-row"><div class="party-name" style="color:${PCOL[i % PCOL.length]}">${p}</div><div class="bar-bg"><div class="bar-fill" style="width:${pc}%;background:${PCOL[i % PCOL.length]}"></div></div><div class="pct">${(s.totals[p] || 0).toLocaleString()} · ${pc}%</div></div>`;
      })
      .join("")
  );
}
function drill() {
  const c = DATA.coll;
  if (!c || c.error) return "";
  const ps = byVotes(c.parties, c.sum.totals).filter((p, i) => (PF() ? p == PF() : i < 10 || c.sum.totals[p] > 0));
  return `<div class="tw"><table><tr><th>${c.level == "nat" ? "Scope" : c.level.toUpperCase()}</th><th>PUs</th><th>Verified</th><th>Disputed</th>${ps.map((p) => "<th>" + p + "</th>").join("")}<th>Total</th></tr>${
    c.rows
      .map(
        (r) =>
          `<tr><td><b>${esc(r.key)}</b></td><td>${r.counts.pus}</td><td>${r.counts.verified}</td><td>${r.counts.disputed ? '<span class="pill r">' + r.counts.disputed + "</span>" : 0}</td>${ps.map((p) => "<td>" + (r.totals[p] || 0) + "</td>").join("")}<td><b>${r.total}</b></td></tr>`,
      )
      .join("") || "<tr><td colspan=30>No data</td></tr>"
  }</table></div>`;
}
// the party being searched for: chosen in the PARTY list, or typed into the search box (e.g. "apc")
const PF = () => F.party || ((CFG?.parties || []).includes((F.q || "").trim().toUpperCase()) ? F.q.trim().toUpperCase() : "");
const flt = (l) =>
  l.filter(
    (o) =>
      (!PF() || (o.t && o.t[PF()])) &&
      (!F.state || o.state == F.state) &&
      (!F.lga || o.lga == F.lga) &&
      (!F.ward || o.ward == F.ward) &&
      (!F.pu || o.pu == F.pu) &&
      (!F.room || o.room_id == F.room) &&
      (!F.q ||
        (PF() && !F.party) ||
        (o.code + (o.name || "") + o.pu + o.ward + o.lga + o.state + o.room_id)
          .toLowerCase()
          .includes(F.q.toLowerCase())),
  );
function setF(k, v) {
  const lv = ["state", "lga", "ward", "pu"],
    i = lv.indexOf(k);
  F[k] = v;
  if (i >= 0) lv.slice(i + 1).forEach((x) => (F[x] = ""));
  fit = true;
  render();
}
function cardSearch(cmd, all) {
  const lv = ["state", "lga", "ward", "pu"],
    FIXST = cmd ? ME.tenantState : ME.room?.state;
  const sel = lv
    .map((k, i) => {
      let p = all;
      for (let j = 0; j < i; j++) if (F[lv[j]]) p = p.filter((o) => o[lv[j]] == F[lv[j]]);
      let v = [...new Set(p.map((o) => o[k]))];
      // one-state Command Center (or a room): the state is fixed, and every LGA of that state is listed
      if (k == "state" && FIXST) return `<select disabled title="This ${cmd ? "Command Center" : "room"} covers ${esc(FIXST)} only"><option>STATE: ${esc(FIXST)}</option></select>`;
      if (k == "lga" && cmd && DATA.lgas) v = [...new Set([...v, ...DATA.lgas])];
      if (k == "state" && cmd && ME.su && DATA.coll?.states) v = [...new Set([...v, ...DATA.coll.states])]; // every state on the platform
      v.sort();
      return `<select onchange="setF('${k}',this.value)"><option value="">${k.toUpperCase()}: All</option>${v.map((x) => `<option ${F[k] == x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
    })
    .join("");
  return `<div class="card"><div class="card-header"><h3><i class="fas fa-sitemap"></i> Hierarchical Search</h3><span class="tag">State → LGA → Ward → PU → Observer</span></div><div class="search-bar">${sel}${cmd ? `<select onchange="setF('room',this.value)"><option value="">ROOM: All</option>${DATA.rooms.map((r) => `<option value="${r.id}" ${F.room == r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>` : ""}<select onchange="setF('party',this.value)"><option value="">PARTY: All</option>${CFG.parties.map((p) => `<option ${F.party == p ? "selected" : ""}>${p}</option>`).join("")}</select><input placeholder="Code, name, PU, ward or party…" value="${esc(F.q || "")}" onchange="setF('q',this.value)"><button class="btn btn-outline" onclick="F={};fit=true;render()"><i class="fas fa-xmark"></i> Clear</button></div></div>`;
}
// ---------- map ----------
const sv = (a, b) =>
  `<a target="_blank" rel="noopener" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${a},${b}">🛣 Open Street View</a>`;
let map,
  mgrp,
  cv,
  BASES = {},
  LCTL,
  hold = document.createElement("div");
hold.id = "map";
function mapMount() {
  const t = $("#mapSlot");
  if (!t || !MS || typeof L == "undefined") return;
  if (!map) {
    map = L.map(hold, { preferCanvas: true }).setView([12.0, 8.52], 9);
    cv = L.canvas({ padding: 0.3 });
    // Keyless basemaps (no API key needed): Esri dark-gray canvas with labels, Esri satellite, OpenStreetMap.
    const E = "https://server.arcgisonline.com/ArcGIS/rest/services/",
      dk = L.layerGroup([
        L.tileLayer(E + "Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles &copy; Esri", maxZoom: 16 }),
        L.tileLayer(E + "Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16 }),
      ]),
      sat = L.layerGroup([
        L.tileLayer(E + "World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles &copy; Esri, Maxar", maxZoom: 19 }),
        L.tileLayer(E + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }),
      ]),
      osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap", maxZoom: 19 });
    dk.addTo(map);
    BASES = { "Dark map": dk, "Streets": osm, "Satellite": sat };
    LCTL = L.control.layers(BASES).addTo(map);
    // Google Map Tiles / Mapbox imagery when the server has a key configured (sharper in Nigerian cities)
    A.get("maps")
      .then((ls) =>
        ls.forEach((x) => {
          const t = L.tileLayer(x.url, { tileSize: x.tileSize || 256, zoomOffset: x.zoomOffset || 0, maxZoom: x.maxZoom || 20, attribution: x.attribution });
          BASES[x.name] = t;
          LCTL.addBaseLayer(t, x.name);
        }),
      )
      .catch(() => {});
    mgrp = L.layerGroup().addTo(map);
    map.on("click", (e) =>
      L.popup()
        .setLatLng(e.latlng)
        .setContent(
          "📍 " +
            e.latlng.lat.toFixed(5) +
            ", " +
            e.latlng.lng.toFixed(5) +
            "<br>" +
            sv(e.latlng.lat, e.latlng.lng),
        )
        .openOn(map),
    );
  }
  t.appendChild(hold);
  setTimeout(() => {
    map.invalidateSize();
    mgrp.clearLayers();
    // canvas circle markers (mockup style: white dot, coloured ring) - fast with tens of thousands of observers
    const pts = [],
      COL = { "": "#38a169", amber: "#d69e2e", grey: "#a0aec0", red: "#e53e3e", blue: "#2b6cb0", navy: "#1a365d" },
      ic = (c) => ({ radius: 7, weight: 3, color: COL[c], fillColor: "#fff", fillOpacity: 1, renderer: cv });
    MS.l.forEach((o) => {
      if (o.lat == null) return;
      const s = st(o);
      L.circleMarker([o.lat, o.lng], ic(o.streaming ? "red" : s == "Live" ? "" : s == "Idle" ? "amber" : "grey"))
        .addTo(mgrp)
        .bindPopup(
          `<b>${esc(o.code)}</b><br>${esc(o.lga)} · PU ${esc(o.pu)}<br>${s}${o.acc != null ? " · GPS ±" + o.acc + " m" : ""}<br><a href="#" onclick="pinpoint(${o.lat},${o.lng});return false">📍 Pinpoint (satellite)</a> · <a href="#" onclick="selObs('${o.code}');return false">Open feed / talkback</a><br>${sv(o.lat, o.lng)}`,
        );
      // GPS accuracy ring: the observer is inside this circle
      if (o.acc != null && o.acc <= 500)
        L.circle([o.lat, o.lng], { radius: o.acc, weight: 1, color: "#38a169", fillOpacity: 0.08, interactive: false, renderer: cv }).addTo(mgrp);
      pts.push([o.lat, o.lng]);
    });
    MS.inc
      .filter((i) => i.status != "resolved" && i.lat != null)
      .forEach((i) => {
        L.circleMarker([i.lat, i.lng], ic("red"))
          .addTo(mgrp)
          .bindPopup(
            "<b>🔴 " +
              esc(i.type) +
              "</b><br>" +
              esc(i.lga) +
              " · PU " +
              esc(i.pu) +
              "<br>" +
              sv(i.lat, i.lng),
          );
        L.circle([i.lat, i.lng], { color: "#e53e3e", fillOpacity: 0.1, radius: 800 }).addTo(mgrp);
        pts.push([i.lat, i.lng]);
      });
    (MS.units || []).forEach((u) =>
      L.circleMarker([u.lat, u.lng], ic("blue"))
        .addTo(mgrp)
        .bindPopup("<b>🔵 " + esc(u.name) + "</b><br>" + u.st),
    );
    if (MS.rooms)
      DATA.rooms.forEach((r) => {
        const l = DATA.obs.filter((o) => o.room_id == r.id && o.lat != null);
        if (l.length)
          L.circleMarker(
            [l.reduce((a, o) => a + o.lat, 0) / l.length, l.reduce((a, o) => a + o.lng, 0) / l.length],
            { ...ic("navy"), radius: 10 },
          )
            .addTo(mgrp)
            .bindPopup("<b>🏛 " + esc(r.name) + "</b><br>" + r.status);
      });
    if (pts.length && fit) {
      map.fitBounds(pts, { maxZoom: 14, padding: [30, 30] });
      fit = false;
    }
  }, 60);
}
const cardMap = (l, x) =>
  `<div class="card" style="flex:1"><div class="card-header"><h3><i class="fas fa-map-location-dot"></i> Live Tactical Map · Observer GPS</h3><span class="tag">${l.filter((o) => st(o) == "Live").length} Observers Live</span></div><div id="mapSlot"></div><div class="muted" style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap"><span>🟢 Observer</span><span>🟡 Idle</span><span>⚪ Offline</span><span>🔴 Incident / streaming</span>${x || ""}</div></div>`;
// zoom to street level on the sharpest satellite layer available
function pinpoint(lat, lng) {
  if (!map) return;
  const pref = ["Google Satellite", "Mapbox Satellite Streets", "Satellite (Esri)"].find((n) => BASES[n]);
  Object.values(BASES).forEach((l) => map.hasLayer(l) && map.removeLayer(l));
  BASES[pref].addTo(map);
  map.setView([lat, lng], 18);
}
function selObs(c) {
  SEL = c;
  if (A.role == "cmd" && TAB != "obs" && TAB != "drill") TAB = "obs";
  render();
}
// ---------- feed (WebRTC) ----------
const vv = document.createElement("video");
vv.autoplay = true;
vv.playsInline = true;
vv.style.cssText = "width:100%;height:100%;object-fit:cover";
function cardFeed(ro) {
  const o = DATA.obs.find((x) => x.code == SEL);
  return `<div class="card"><div class="card-header"><h3><i class="fas fa-video"></i> Live Video Feed</h3><span class="tag">${o ? esc(o.code) + " · " + esc(o.lga) + " · PU " + esc(o.pu) + " · " + (o.streaming ? "🔴 streaming" : o.live_req ? "⏳ live requested" : "not streaming") : "Select an observer"}</span></div><div class="video-container" id="vslot">${o ? "" : '<span style="opacity:.6">Click an observer marker or row</span>'}</div>
${o && !ro ? `<div class="video-controls">${o.live_req ? `<button class="btn btn-danger" onclick="liveReq(SEL,false)"><i class="fas fa-video-slash"></i> End live video</button>` : `<button class="btn btn-danger" onclick="liveReq(SEL,true)"><i class="fas fa-video"></i> Request live video</button>`}<button class="btn btn-success" onclick="A.watch(SEL,vv,false)"><i class="fas fa-play"></i> Watch</button><button class="btn btn-outline" onclick="A.watch(SEL,vv,true)"><i class="fas fa-microphone"></i> Talkback (2-way audio)</button><button class="btn btn-outline" onclick="A.unwatch(SEL);vv.srcObject=null"><i class="fas fa-stop"></i> Stop</button><button class="btn btn-outline" onclick="msgTo('obs:'+SEL,'Please save your clip now','save')"><i class="fas fa-record-vinyl"></i> Save 60s Clip</button><button class="btn btn-outline" onclick="snapshot()"><i class="fas fa-camera"></i> Snapshot</button>${CFG.lk ? '<button class="btn btn-outline" onclick="restream()"><i class="fas fa-tower-broadcast"></i> Restream (YouTube/FB)</button><button class="btn btn-outline" onclick="restreamStop()">Stop restream</button>' : ""}<div class="share-dropdown"><button class="btn btn-primary" onclick="event.stopPropagation();$('#sm').classList.toggle('show')"><i class="fas fa-share-nodes"></i> Share Feed</button><div class="share-menu" id="sm">${["CP Command", "INEC", "NSCDC", "Dispatch", "Command Center"].map((x) => `<div onclick="shareTo('${x}')">${x}</div>`).join("")}</div></div></div>` : ""}</div>`;
}
// on-demand video: the observer phone starts its camera when asked and stops when ended (saves data + battery)
async function liveReq(code, on) {
  try {
    const r = await A.post("obs/" + code + "/live", { on });
    toast(on ? (r.delivered ? "📡 Live video requested - the phone is starting its camera." : "📡 Requested. The observer app is not open; it will start when the observer opens it.") : "⏹ Live video ended.");
    if (on) setTimeout(() => A.watch(code, vv, false).catch(() => {}), 4000);
    else A.unwatch(code);
    loadAll();
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
async function resetDev(code) {
  if (!confirm("Reset the phone lock for " + code + "? The current phone is logged out; the next phone that logs in with this code (and a new PIN) takes it over.")) return;
  try {
    await A.post("obs/" + code + "/reset-device");
    toast("🔓 Device lock reset for " + code);
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
function snapshot() {
  if (!vv.videoWidth) return toast("No video yet.");
  const c = document.createElement("canvas");
  c.width = vv.videoWidth;
  c.height = vv.videoHeight;
  c.getContext("2d").drawImage(vv, 0, 0);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/jpeg", 0.9);
  a.download = SEL + "_" + Date.now() + ".jpg";
  a.click();
}
async function restream() {
  const u = prompt("RTMP URL + stream key, e.g. rtmp://a.rtmp.youtube.com/live2/XXXX-XXXX-XXXX");
  if (!u) return;
  try {
    await A.post("restream", { code: SEL, url: u.trim() });
    toast("📡 Restream started.");
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
const restreamStop = () =>
  A.post("restream/stop", { code: SEL })
    .then(() => toast("Restream stopped."))
    .catch((e) => toast("⚠️ " + e.message));
const tallyCell = (o) =>
  Object.entries(o.t || {})
    .sort((a, b) => b[1].v - a[1].v)
    .map(
      ([p, x]) =>
        `<span class="tag" title="${esc((x.hist || []).map((h) => h.v + " (" + h.src + " " + TM(h.ts) + ")").join(" → "))}">${p} ${x.v}${x.edits ? " ✎" : ""}</span>`,
    )
    .join(" ") || "—";
async function shareTo(x) {
  await A.post("share", { code: SEL, to: x });
  toast("📤 Feed " + SEL + " shared to " + x + " (logged).");
}
addEventListener("click", () => $("#sm")?.classList.remove("show"));
// ---------- messages ----------
async function msgTo(to, text, cmd) {
  if (!text) return toast("Type a message first.");
  try {
    await A.post("messages", { to, text, cmd });
    toast("📨 Sent.");
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
const ackMsg = (id) => A.post("messages/" + id + "/ack");
function cardMsgs(targets) {
  return `<div class="card"><div class="card-header"><h3><i class="fas fa-comments"></i> Messages</h3></div>${targets ? `<div class="search-bar"><select id="mt">${targets.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select><input id="mx" placeholder="Message to the observer (shown on their screen)"><button class="btn btn-primary" onclick="msgTo($('#mt').value,$('#mx').value)">Send</button></div>` : ""}<div class="contact-list">${
    DATA.msg
      .filter((m) => !m.cmd)
      .slice(0, 10)
      .map(
        (m) =>
          `<div class="contact-item"><div class="info"><div class="role">${esc(m.from_id)} → ${esc(m.to_scope)}</div><div>${esc(m.text)}</div><div class="loc">${TM(m.ts)} · ${m.ack.length} ack</div></div>${m.from_id != ME.id && !m.ack.includes(ME.id) && A.role != "cmd" ? `<button class="btn btn-sm btn-success" onclick="ackMsg(${m.id})">Acknowledge</button>` : ""}</div>`,
      )
      .join("") || '<div class="muted">No messages.</div>'
  }</div></div>`;
}
// ---------- collation ----------
function cardColl() {
  return `<div class="card"><div class="card-header"><h3><i class="fas fa-chart-column"></i> Real-Time Collation</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${[
    ["nat", "All"],
    ["state", "State"],
    ["lga", "LGA"],
    ["ward", "Ward"],
    ["pu", "PU"],
  ]
    .map(
      ([k, n]) =>
        `<button class="btn btn-sm ${LVL == k ? "btn-primary" : "btn-outline"}" onclick="LVL='${k}';render()">${n}</button>`,
    )
    .join("")}${(A.role == "cmd" && TAB == "col" && (ME.tenantState || ME.su)) || (A.role == "room" && ME.room?.state) ? `<span style="width:1px;background:#e2e8f0;margin:0 4px"></span><button class="btn btn-sm ${POOLED ? "btn-primary" : "btn-outline"}" onclick="POOLED=true;render()" title="Vote counts from every pooled Command Center">${A.role == "room" ? (String(ME.room.scope || "").includes(",") ? "Whole zone" : "Whole LGA") : ME.su ? "All states" : "Whole state"}</button><button class="btn btn-sm ${!POOLED ? "btn-primary" : "btn-outline"}" onclick="POOLED=false;render()">${A.role == "room" ? "This room only" : "This Command Center only"}</button>` : ""}</div></div><div id="collSlot">${hist()}<div style="margin-top:12px">${drill()}</div></div></div>`;
}
// ---------- results & EC8A review (two observers per PU, supervisor resolves) ----------
let PUF = "", // show every polling unit by default (disputed ones are listed first); the buttons narrow it down
  PUS_ = null,
  PUK = null,
  RES = null;
function pusQ() {
  const p = new URLSearchParams();
  if (PUF) p.set("status", PUF);
  COLL_KEYS.forEach((x) => (x == "room" ? F.room || CR : F[x]) && p.set(x, x == "room" ? F.room || CR : F[x]));
  return String(p);
}
async function loadPus() {
  const p = pusQ();
  PUK = p;
  try {
    PUS_ = await A.get("pus?" + p);
  } catch (e) {
    PUS_ = { count: 0, items: [], error: e.message };
  }
  refresh();
}
async function viewEc8a(id) {
  try {
    // shown in the page: a new window opened after waiting on the server is blocked by browsers
    const url = URL.createObjectURL(await A.get("ec8a/" + id + "/file"));
    document.getElementById("ecm")?.remove();
    const w = document.createElement("div");
    w.id = "ecm";
    w.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.88);z-index:9500;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:12px";
    w.innerHTML = `<img src="${url}" alt="EC8A result sheet" style="max-width:100%;max-height:82vh;border-radius:10px;background:#fff"><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn btn-primary" href="${url}" download="EC8A-${id}.jpg"><i class="fas fa-download"></i> Download</a><a class="btn btn-outline" style="background:#fff" href="${url}" target="_blank" rel="noopener">Open full size</a><button class="btn btn-outline" style="background:#fff" id="ecx">Close</button></div>`;
    w.onclick = (e) => (e.target == w || e.target.id == "ecx") && w.remove();
    document.body.appendChild(w);
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
function tabResults(ro) {
  if (!PUS_ || PUK !== pusQ()) setTimeout(loadPus, 0);
  const l = PUS_?.items || [];
  const form = (x) => {
    const ps = [...new Set([...x.obs.flatMap((o) => Object.keys(o.t)), ...Object.keys(x.fig || {})])],
      src = x.fig || x.obs.find((o) => Object.keys(o.t).length)?.t || {};
    return `<div class="search-bar" style="flex-direction:column;align-items:stretch"><div class="muted">Enter the figures on the EC8A sheet (pre-filled from ${x.fig ? "the counted figures" : "the first observer"}). Add parties with 0 if needed.</div><div style="display:flex;gap:8px;flex-wrap:wrap">${CFG.parties
      .filter((p) => ps.includes(p) || CFG.parties.indexOf(p) < 5)
      .map((p) => `<label class="tag">${p} <input id="rf_${p}" type="number" min="0" style="width:80px" value="${src[p] ?? ""}"></label>`)
      .join("")}</div><input id="rf_note" placeholder="Note (required), e.g. 'Matches EC8A photo; OBS-xxxx misheard PDP'"><div style="display:flex;gap:8px">${x.obs
      .filter((o) => Object.keys(o.t).length)
      .map((o) => `<button class="btn btn-sm btn-outline" onclick='fillRes(${JSON.stringify(o.t)})'>Use ${esc(o.code)}</button>`)
      .join("")}<button class="btn btn-success btn-sm" onclick="saveRes()"><i class="fas fa-check"></i> Save final result</button><button class="btn btn-outline btn-sm" onclick="RES=null;render()">Cancel</button></div></div>`;
  };
  return `<div class="card"><div class="card-header"><h3><i class="fas fa-scale-balanced"></i> Results Review · 2 observers per PU · EC8A</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${[
    ["disputed", "Disputed"],
    ["unverified", "Not verified"],
    ["partial", "Entering"],
    ["single", "Single"],
    ["matched", "Matched"],
    ["resolved", "Resolved"],
    ["", "All"],
  ]
    .map(([v, n]) => `<button class="btn btn-sm ${PUF == v ? "btn-primary" : "btn-outline"}" onclick="PUF='${v}';PUS_=null;render()">${n}</button>`)
    .join("")}<button class="btn btn-sm btn-outline" onclick="loadPus()"><i class="fas fa-rotate"></i></button></div></div><div class="muted" style="margin-bottom:10px">${PUS_ ? PUS_.count + " PU(s)" + (PUS_.count > 1000 ? " - showing first 1000; narrow with the search above" : "") : "Loading…"}. Disputed PUs are left out of the totals until ${ro ? "the Situation Room supervisor" : "you"} resolve${ro ? "s" : ""} them. A PU is verified when the figures match (or are resolved) and an EC8A photo is on file.</div><div class="incident-list">${
    l
      .map((x) => {
        const ps = [...new Set(x.obs.flatMap((o) => Object.keys(o.t)))];
        return `<div class="incident-item ${x.status == "disputed" || x.anomaly ? "" : x.verified ? "green" : x.status == "resolved" ? "blue" : "yellow"}" style="flex-direction:column;align-items:stretch"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div class="incident-info"><div class="title">${esc(x.lga)} · ${esc(x.ward)} · PU ${esc(x.pu)}${x.pu_name ? " · " + esc(x.pu_name) : ""}</div><div class="meta">${x.room_id} · registered ${x.reg}${x.acc != null ? " · accredited (BVAS) " + x.acc : ""}${x.sheetConflict ? ' · <b style="color:#e53e3e">observers read different EC8A voter figures</b>' : ""} · counted total ${x.total}${x.res ? " · resolved by " + esc(x.res.by) + ": " + esc(x.res.note) : ""}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${pillS(x.status)}${x.verified ? pillS("verified") : ""}${x.anomaly ? pillS("anomaly") : ""}${x.photos.map((p, i) => `<button class="btn btn-sm btn-outline" onclick="viewEc8a(${p.id})" title="SHA-256 ${p.sha256}"><i class="fas fa-file-image"></i> EC8A ${i + 1}</button>`).join("") || '<span class="pill s">No EC8A</span>'}${ro ? "" : `<button class="btn btn-sm btn-primary" onclick="RES='${esc(x.key)}';render()">${x.status == "resolved" ? "Edit result" : "Resolve"}</button>${x.status == "resolved" ? `<button class="btn btn-sm btn-outline" onclick='unRes(${JSON.stringify({ state: x.state, lga: x.lga, ward: x.ward, pu: x.pu })})'>Reopen</button>` : ""}`}</div></div><div class="tw" style="margin-top:8px"><table><tr><th>Observer</th>${ps.map((p) => "<th>" + p + "</th>").join("")}<th>Total</th></tr>${x.obs
          .map((o) => {
            const t = Object.values(o.t).reduce((a, b) => a + b, 0);
            return `<tr><td class="mono">${esc(o.code)}${o.name ? " · " + esc(o.name) : ""}</td>${ps.map((p) => {
              const vs = new Set(x.obs.filter((z) => p in z.t).map((z) => z.t[p]));
              return `<td style="${vs.size > 1 ? "color:#e53e3e;font-weight:700" : ""}">${o.t[p] ?? "—"}</td>`;
            }).join("")}<td>${t}</td></tr>`;
          })
          .join("")}${x.status == "resolved" ? `<tr><td><b>FINAL</b></td>${ps.map((p) => "<td><b>" + (x.fig[p] ?? "—") + "</b></td>").join("")}<td><b>${x.total}</b></td></tr>` : ""}</table></div>${RES == x.key && !ro ? form(x) : ""}</div>`;
      })
      .join("") || '<div class="muted">Nothing in this list.</div>'
  }</div></div>`;
}
function fillRes(t) {
  CFG.parties.forEach((p) => {
    const e = $("#rf_" + p);
    if (e) e.value = t[p] ?? "";
  });
}
async function saveRes() {
  const x = PUS_.items.find((z) => z.key == RES),
    final = {};
  CFG.parties.forEach((p) => {
    const e = $("#rf_" + p);
    if (e && e.value !== "") final[p] = parseInt(e.value, 10);
  });
  try {
    await A.post("pus/resolve", { state: x.state, lga: x.lga, ward: x.ward, pu: x.pu, final, note: $("#rf_note").value, by: ME.room?.operator || ME.id });
    toast("✅ Final result saved for PU " + x.pu);
    RES = null;
    loadPus();
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
async function unRes(k) {
  if (!confirm("Reopen this PU? It goes back to the observers' figures.")) return;
  try {
    await A.post("pus/unresolve", k);
    loadPus();
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
// ---------- dispatch / radio ----------
function cardDispatch(rid, ro) {
  const inc = DATA.inc.filter((i) => i.room_id == rid),
    us = DATA.units.filter((u) => u.room_id == rid);
  return `<div class="card"><div class="card-header"><h3><i class="fas fa-triangle-exclamation"></i> Dispatch Queue</h3>${ro ? "" : '<button class="btn btn-outline btn-sm" onclick="addUnit()"><i class="fas fa-plus"></i> Unit</button>'}</div><div class="incident-list">${
    inc
      .map((i) => {
        const n = us
          .filter((u) => u.st == "free" && i.lat != null)
          .map((u) => ({ u, d: hav(u.lat, u.lng, i.lat, i.lng) }))
          .sort((a, b) => a.d - b.d)[0];
        return `<div class="incident-item ${i.status == "resolved" ? "green" : i.status == "dispatched" ? "blue" : ""}"><div class="incident-info"><div class="title">${esc(i.type)} · ${esc(i.code)}</div><div class="meta">${esc(i.lga)} · PU ${esc(i.pu)} · ${DT(i.ts)} · ${i.status}${i.note ? " · " + esc(i.note) : ""}</div><div class="meta">${i.status == "new" ? (n ? "Nearest: " + esc(n.u.name) + " · ETA " + Math.max(1, Math.round((n.d / 40) * 60)) + " min" : "No free unit") : esc(i.unit || "")}</div></div>${ro ? "" : `<div style="display:flex;gap:6px">${i.status == "new" ? `<button class="btn btn-danger btn-sm" onclick="A.post('incidents/${i.id}/dispatch',{unit:'${n ? esc(n.u.name) : ""}'})">Dispatch</button>` : ""}${i.status != "resolved" ? `<button class="btn btn-success btn-sm" onclick="A.post('incidents/${i.id}/resolve')">Resolve</button>` : ""}<button class="btn btn-outline btn-sm" onclick="selObs('${i.code}')">Feed</button></div>`}</div>`;
      })
      .join("") || '<div class="muted">No incidents.</div>'
  }</div></div>`;
}
async function radioKey() {
  if (!confirm("Generate a NEW gateway key? The previous key stops working.")) return;
  try {
    const r = await A.post("radio/key");
    prompt("Copy this key into the gateway PC (shown once):", r.key);
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
async function playRadio(id) {
  try {
    const b = await A.get("radio/" + id + "/audio"),
      a = new Audio(URL.createObjectURL(b));
    a.play();
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
async function addUnit() {
  const v = prompt("Unit name, latitude, longitude (e.g. Patrol 9, 12.01, 8.52):");
  if (!v) return;
  const [name, lat, lng] = v.split(",").map((x) => x.trim());
  try {
    await A.post("units", { name, lat, lng });
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
// radio monitor used by the Command Center and read-only room drill (playback only, with room labels)
const cardRadioView = () =>
  `<div class="radio-module"><div style="display:flex;justify-content:space-between;align-items:center"><b><i class="fas fa-tower-broadcast"></i> Radio monitor</b><span style="display:flex;gap:8px;align-items:center">${radioListenBtn()}<span class="tag" style="background:#1a202c;color:#a0aec0">${DATA.radio.length} transmissions</span></span></div><div class="radio-log" style="max-height:360px">${DATA.radio.map((x) => `<div><span class="time">${TM(x.ts)}</span>${x.room_name ? '<span style="color:#63b3ed">' + esc(x.room_name) + "</span> " : ""}<span class="${x.alert ? "alert" : ""}">${esc(x.text)}${x.freq ? " [" + esc(x.freq) + (x.talkgroup ? " TG " + esc(x.talkgroup) : "") + "]" : ""}</span>${x.has_audio ? ` <a href="#" style="color:#68d391" onclick="playRadio(${x.id});return false">▶ play</a>` : ""}</div>`).join("") || '<div class="muted" style="padding:10px">No radio yet. A listening post (SDR + antenna) near the area feeds this through the room\'s gateway key. See radio-gateway/README.md.</div>'}</div></div>`;
const cardRadio = () =>
  cardRadioCtl() + `<div class="radio-module"><div style="display:flex;justify-content:space-between;align-items:center"><b><i class="fas fa-tower-broadcast"></i> Radio (SDR gateway · P25/TETRA/DMR)</b><span style="display:flex;gap:8px;align-items:center">${radioListenBtn()}<button class="btn btn-sm btn-primary" onclick="radioKey()"><i class="fas fa-key"></i> Gateway key</button></span></div><div class="radio-log">${DATA.radio.map((x) => `<div><span class="time">${TM(x.ts)}</span><span class="${x.alert ? "alert" : ""}">${esc(x.text)}${x.freq ? " [" + esc(x.freq) + (x.talkgroup ? " TG " + esc(x.talkgroup) : "") + "]" : ""}</span>${x.has_audio ? ` <a href="#" style="color:#68d391" onclick="playRadio(${x.id});return false">▶ play</a>` : ""}</div>`).join("")}</div><div class="search-bar" style="margin:10px 0 0;background:#0d1117;border:0"><input id="rx" placeholder="Log a note to the radio timeline" style="background:#1a202c;color:#fff;border-color:#2d3748"><button class="btn btn-primary btn-sm" onclick="A.post('radio',{text:$('#rx').value})">Log note</button></div></div>`;
function roomDash(rid, ro) {
  CR = ro ? rid : null;
  const all = DATA.obs.filter((o) => o.room_id == rid),
    l = flt(all);
  MS = {
    l,
    inc: DATA.inc.filter((i) => i.room_id == rid),
    units: DATA.units.filter((u) => u.room_id == rid),
  };
  return `<div class="dashboard-grid"><div class="col">${cardSearch(0, all)}${cardMap(l, "<span>🔵 Patrol Unit</span>")}${cardDispatch(rid, ro)}</div><div class="col">${cardFeed(ro)}${cardColl()}${ro ? cardRadioView() : cardRadio()}${cardMsgs(ro ? null : [["robs:" + rid, "All my observers"], ...all.map((o) => ["obs:" + o.code, o.code]), ["CMD", "Command Center"]])}</div></div>`;
}
// ---------- contacts / data / audit ----------
function tabContacts() {
  const room = A.role == "room";
  return `<div class="dashboard-grid"><div class="card"><div class="card-header"><h3><i class="fas fa-address-book"></i> Add Contact</h3></div><input class="fi" id="cn" placeholder="Name"><input class="fi" id="cp" placeholder="Phone"><select class="fi" id="cr"><option>Emergency</option><option>Security</option><option>Supervisor</option></select><select class="fi" id="cv"><option>State</option><option>LGA</option><option>Ward</option><option>PU</option></select><select class="fi" id="cs">${CFG.states.map((s) => `<option ${room && s == ME.room.state ? "selected" : ""}>${s}</option>`).join("")}</select><input class="fi" id="cl" placeholder="LGA / Ward / PU (as applicable)"><button class="btn btn-primary" onclick="addCon()"><i class="fas fa-plus"></i> Add Contact</button><div class="card-header" style="margin-top:18px"><h3><i class="fas fa-file-import"></i> Bulk upload (Excel .xlsx / CSV / TXT)</h3><button class="btn btn-outline btn-sm" onclick="conTpl()"><i class="fas fa-download"></i> Template</button></div><div class="muted" style="margin-bottom:8px">Columns: <span class="mono">name, phone, role, level, state, lga, ward, pu</span> (role: Emergency / Security / Supervisor; level: State / LGA / Ward / PU). First row = headers. Up to 20,000 rows.</div><input class="fi" type="file" id="cf" accept=".xlsx,.csv,.txt"><button class="btn btn-success" onclick="bulkCon()"><i class="fas fa-upload"></i> Import contacts</button><div id="cfo" class="muted"></div>${room ? "" : '<div class="muted" style="margin-top:8px">Command contacts propagate to every Situation Room in that state.</div>'}</div>
<div class="card"><div class="card-header"><h3><i class="fas fa-phone"></i> Contacts (${DATA.con.length})</h3></div><div class="contact-list">${DATA.con.map((c) => `<div class="contact-item"><div class="info"><div class="role">${esc(c.name)} · ${esc(c.role)}</div><div class="loc">${esc(c.state)} · ${esc(c.loc)} · ${esc(c.level)} level${c.room_id ? "" : " · Command"}</div></div><div><a class="btn btn-success btn-sm" href="tel:${esc(c.phone)}"><i class="fas fa-phone"></i> ${esc(c.phone)}</a> ${A.role == "cmd" || c.room_id ? `<button class="btn btn-sm btn-outline" onclick="A.del('contacts/${c.id}')"><i class="fas fa-trash"></i></button>` : ""}</div></div>`).join("") || '<div class="muted">No contacts.</div>'}</div></div></div>`;
}
function parseCSV(t) {
  const first = t.split(/\r?\n/)[0],
    d = [",", "\t", ";", "|"].sort((a, b) => first.split(b).length - first.split(a).length)[0],
    rows = [];
  let row = [],
    f = "",
    qq = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (qq) {
      if (c == '"' && t[i + 1] == '"') (f += '"'), i++;
      else if (c == '"') qq = false;
      else f += c;
    } else if (c == '"') qq = true;
    else if (c == d) row.push(f), (f = "");
    else if (c == "\n" || c == "\r") {
      if (c == "\r" && t[i + 1] == "\n") i++;
      row.push(f), rows.push(row), (row = []), (f = "");
    } else f += c;
  }
  if (f || row.length) row.push(f), rows.push(row);
  const h = (rows.shift() || []).map((x) => x.trim().toLowerCase());
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] || "").trim()])));
}
async function bulkCon() {
  const f = $("#cf").files[0];
  if (!f) return toast("Choose a file first.");
  try {
    let rows;
    if (/\.xls$/i.test(f.name)) return toast("⚠️ Old .xls format: open it in Excel and Save As .xlsx or .csv.");
    if (/\.xlsx$/i.test(f.name)) {
      if (!window.readXlsxFile) return toast("⚠️ Excel reader not loaded. Save as CSV instead.");
      const a = await readXlsxFile(f),
        h = (a.shift() || []).map((x) => String(x ?? "").trim().toLowerCase());
      rows = a.filter((r) => r.some((x) => x != null && x !== "")).map((r) => Object.fromEntries(h.map((k, i) => [k, String(r[i] ?? "")])));
    } else rows = parseCSV(await f.text());
    rows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim().toLowerCase().replace(/[^a-z]/g, ""), String(v).trim()])));
    rows = rows.map((r) => ({ ...r, phone: r.phone || r.phonenumber || r.mobile || r.tel, name: r.name || r.fullname || r.contactname }));
    const r = await A.post("contacts/bulk", { rows });
    $("#cfo").innerHTML = `✅ ${r.added} added · ${r.rejected} rejected${r.errors.length ? "<br>" + r.errors.map((e) => "Row " + e.row + ": " + esc(e.error)).join("<br>") : ""}`;
    toast("✅ " + r.added + " contacts imported.");
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
function conTpl() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["name,phone,role,level,state,lga,ward,pu\nDPO Dala,+2348030000001,Security,LGA,Kano,Dala,,\nWard Supervisor,+2348030000002,Supervisor,Ward,Kano,Dala,Gwammaja,\n"], { type: "text/csv" }));
  a.download = "contacts_template.csv";
  a.click();
}
async function addCon() {
  const g = (i) => $("#" + i).value.trim();
  try {
    await A.post("contacts", {
      name: g("cn"),
      phone: g("cp"),
      role: g("cr"),
      level: g("cv"),
      state: g("cs"),
      loc: g("cl"),
    });
    toast("✅ Contact added.");
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
const tabData = () =>
  `<div class="dashboard-grid"><div class="card"><div class="card-header"><h3><i class="fas fa-file-arrow-down"></i> Text Data ${A.role == "room" ? "(this room)" : "(ALL rooms)"}</h3></div><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-primary" onclick="A.dl('export/csv','tallies.csv')"><i class="fas fa-file-csv"></i> Tallies CSV</button><button class="btn btn-primary" onclick="A.dl('export/json','collation.json')"><i class="fas fa-file-code"></i> ${A.role == "room" ? "Room JSON" : "Full Archive JSON"}</button></div><div class="muted" style="margin-top:12px">All data is stored in the PostgreSQL database and video on the disk of the server PC. Every export is audit-logged.</div></div><div class="card"><div class="card-header"><h3><i class="fas fa-film"></i> Video Recordings</h3><button class="btn btn-outline btn-sm" onclick="DATA.clips.forEach((c,i)=>setTimeout(()=>A.dl('clips/'+c.id+'/file',c.code+'_'+c.id+'.webm'),i*400))">Download all</button></div><div class="contact-list">${DATA.clips.map((c) => `<div class="contact-item"><div class="info"><div class="role">${esc(c.code)} · ${esc(c.kind)}</div><div class="loc">${DT(c.ts)}</div></div><button class="btn btn-sm btn-primary" onclick="A.dl('clips/${c.id}/file','${c.code}_${c.id}.webm')"><i class="fas fa-download"></i></button></div>`).join("") || '<div class="muted">No clips yet. Observers save clips on incidents, on stop, or on request.</div>'}</div></div></div>`;
const tabAudit = () =>
  `<div class="card"><div class="card-header"><h3><i class="fas fa-clipboard-list"></i> Audit Log</h3></div><div class="tw"><table><tr><th>Time</th><th>Who</th><th>Action</th></tr>${DATA.aud.map((a) => `<tr><td>${DT(a.ts)}</td><td>${esc(a.who)}</td><td>${esc(a.action)}</td></tr>`).join("")}</table></div></div>`;
// ---------- shell ----------
async function loadAll() {
  const g = (p) => A.get(p).catch(() => []);
  [DATA.obs, DATA.inc, DATA.msg, DATA.con, DATA.units] = await Promise.all([
    g("obs"),
    g("incidents"),
    g("messages"),
    g("contacts"),
    g("units"),
  ]);
  if (A.role == "cmd")
    [DATA.rooms, DATA.clips, DATA.bc, DATA.aud, DATA.set, DATA.cu, DATA.tn] = await Promise.all([
      g("rooms"),
      g("clips"),
      g("broadcasts"),
      g("audit"),
      g("settings"),
      g("cmdusers"),
      ME.su ? g("tenants") : [],
    ]);
  else [DATA.radio, DATA.clips] = await Promise.all([g("radio"), g("clips")]);
  if (A.role == "cmd") DATA.radio = await g("radio" + (DRILL ? "?room=" + DRILL : F.radioRoom ? "?room=" + F.radioRoom : ""));
  // listening-post control (on/off, tuning): this room's own, or the room chosen on the Command Center's Radio tab
  {
    const rr = A.role == "room" ? "" : DRILL ? null : F.radioRoom || null;
    DATA.rctl = A.role == "room" || rr ? await A.get("radio/control" + (rr ? "?room=" + encodeURIComponent(rr) : "")).catch(() => null) : null;
  }
  radioAuto();
  if (A.role == "cmd") DATA.totp = await A.get("totp").catch(() => ({}));
  // a Command Center locked to one state: its LGA list, for the room form and the search filters
  if (A.role == "cmd" && ME.tenantState && !DATA.lgas) DATA.lgas = (await g("locations?state=" + encodeURIComponent(ME.tenantState))).map((x) => x.lga);
  if (A.role == "cmd" && ME.su) DATA.bk = await A.get("backups").catch(() => null);
  if (A.role == "cmd" && ME.su) DATA.mkt = await A.get("pitch/stats").catch(() => null);
  if ($("#collSlot")) loadColl();
  if (TAB == "res" && PUS_) loadPus();
  if (A.role == "room")
    A.get("me")
      .then((m) => (ME = m))
      .catch(() => {});
  refresh();
}
let dl_;
const debLoad = () => {
  clearTimeout(dl_);
  dl_ = setTimeout(loadAll, 300);
};
function refresh() {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  render();
}
function render() {
  if (document.activeElement && /^(rc_|bm$)/.test(document.activeElement.id)) return; // a frequency is being typed
  const tb = {
    ...TABS(),
    ...(A.role == "cmd" && DRILL
      ? { drill: ["Room: " + DRILL + " (read-only)", "eye", () => roomDash(DRILL, true)] }
      : {}),
  };
  if (!tb[TAB]) TAB = Object.keys(tb)[0];
  MS = null;
  CR = null;
  $("#app").innerHTML =
    `<div class="mockup-container"><div class="topbar"><div class="brand"><i class="fas fa-shield-halved"></i><h1>${esc(CFG?.appName || "My Collation Center")} <span>· ${A.role == "cmd" ? esc(ME.tenant || "Command Center") : esc(ME.room.name)}</span></h1></div><div class="topbar-actions"><span class="tag"><i class="fas fa-circle" style="color:#38a169"></i> ${A.role == "cmd" ? DATA.rooms.filter((r) => r.status == "active").length + " rooms active" : "Activated by Command Center " + DT(ME.room.activated_at)}</span><span class="tag"><i class="fas fa-user-shield"></i> ${A.role == "cmd" ? esc(ME.name || "Command") : esc(ME.room.operator || ME.id)}</span><button class="btn btn-outline" onclick="logout()"><i class="fas fa-right-from-bracket"></i> Logout</button></div></div><div class="nav-tabs">${Object.entries(
      tb,
    )
      .map(
        ([k, [l, i]]) =>
          `<div class="nav-tab ${k == TAB ? "active" : ""}" onclick="TAB='${k}';fit=true;render()"><i class="fas fa-${i}"></i> ${l}</div>`,
      )
      .join("")}</div><div class="view">${tb[TAB][2]()}</div></div>`;
  const s = $("#vslot");
  if (s && SEL) s.appendChild(vv);
  mapMount();
  if ($("#collSlot") && DATA.collKey !== collKey()) loadColl();
}
function loginView(role) {
  const LC = takeCreds(role);
  if (LC && LC.p) setTimeout(doLogin, 50); // arrived by QR: sign straight in
  $("#app").innerHTML =
    `<div class="mockup-container"><div class="topbar"><div class="brand"><i class="fas fa-shield-halved"></i><h1>${esc(CFG?.appName || "My Collation Center")} <span>· ${role == "cmd" ? "Command Center" : "Situation Room"}</span></h1></div></div><div class="card" style="max-width:420px"><input class="fi" id="li" placeholder="${role == "room" ? "Room ID (e.g. SR-KN-AB3)" : "Operator name (e.g. admin)"}" value="${esc(LC?.u || "")}" autocapitalize="none" autocomplete="username"><input class="fi" id="lp" type="password" placeholder="${role == "cmd" ? "Command passcode" : "Room passcode"}" value="${esc(LC?.p || "")}" onkeydown="event.key=='Enter'&&doLogin()">${role == "cmd" ? `<input class="fi" id="lo" inputmode="numeric" maxlength="6" placeholder="6-digit code (only if two-step login is on)" onkeydown="event.key=='Enter'&&doLogin()">` : ""}<button class="btn btn-primary" onclick="doLogin()">Enter</button><button class="btn btn-outline" style="margin-top:8px" onclick="scanLogin('${role}',(c)=>{$('#li').value=c.u;$('#lp').value=c.p;doLogin()})"><i class="fas fa-qrcode"></i> Scan QR code instead</button><div class="muted" style="margin-top:8px">${role == "cmd" ? "First login: operator <b>admin</b>; the passcode is printed once in the server console (or set COMMAND_PASSCODE)." : "Your room must be activated by Command Center. Passcode is issued by Command Center."}</div></div></div>`;
}
async function doLogin() {
  try {
    const r = await A.post("login/" + (A.role == "cmd" ? "command" : "room"), {
      id: $("#li")?.value.trim(),
      pass: $("#lp").value,
      otp: $("#lo")?.value.trim(),
    });
    sessionStorage.setItem("t", r.token);
    start(A.role, TABS);
  } catch (e) {
    toast("❌ " + e.message);
    if (/6-digit/.test(e.message)) $("#lo")?.focus();
  }
}
async function start(role, tabsFn) {
  A.role = role;
  TABS = tabsFn;
  try {
    CFG = await A.get("config");
    document.title = CFG.appName + " · " + (role == "cmd" ? "Command Center" : "Situation Room");
  } catch {}
  if (!A.tok) return loginView(role);
  try {
    ME = await A.get("me");
    CFG = await A.get("config");
  } catch {
    sessionStorage.removeItem("t");
    return loginView(role);
  }
  A.ws((m) => (m.type == "changed" ? debLoad() : A.sig(m)));
  await loadAll();
  setInterval(() => A.tok && document.visibilityState == "visible" && loadAll(), 10000);
}

// ================= QR credentials: show, print, scan, and sign in by QR =================
const ORIGIN = BASE || location.origin;
// the sign-in link a QR carries. The details sit after "#", which browsers never send to a server.
const loginLink = (kind, u, p) =>
  ORIGIN + "/" + (kind == "cmd" ? "command" : kind == "room" ? "room" : "observer") + "/#u=" + encodeURIComponent(u) + (p ? "&p=" + encodeURIComponent(p) : "");
function qrSvg(text, cell) {
  if (!window.qrcode) return "";
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell || 4, margin: 2 });
}
// read (once) the sign-in details that arrived by QR: from the page link, or handed over by the Android app's scanner
function takeCreds(kind) {
  let c = null;
  try {
    const hp = new URLSearchParams(location.hash.slice(1));
    if (hp.get("u")) {
      c = { u: hp.get("u"), p: hp.get("p") || "" };
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      const s = JSON.parse(localStorage.getItem("mcc_login") || "null");
      if (s && s.kind == kind) c = s;
      if (s) localStorage.removeItem("mcc_login");
    }
  } catch {}
  return c;
}
// what a scanned QR means: { kind, origin, u, p } or null
function parseLoginQR(text) {
  try {
    const url = new URL(String(text).trim()),
      m = url.pathname.match(/\/(command|room|observer)\/?$/),
      hp = new URLSearchParams(url.hash.slice(1));
    if (!m || !hp.get("u")) return null;
    return { kind: { command: "cmd", room: "room", observer: "obs" }[m[1]], origin: url.origin, u: hp.get("u"), p: hp.get("p") || "" };
  } catch {
    return null;
  }
}
const loadScript = (src) =>
  new Promise((ok, no) => {
    if ([...document.scripts].some((s) => s.dataset.src == src)) return ok();
    const s = document.createElement("script");
    s.src = src;
    s.dataset.src = src;
    s.onload = ok;
    s.onerror = () => no(new Error("Could not load the scanner"));
    document.head.appendChild(s);
  });
// full-screen camera scanner; resolves with the QR text, or null if closed
async function scanQR() {
  await loadScript("/vendor/jsqr.js");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    throw new Error("Camera unavailable — allow camera access, or type the details instead");
  }
  return new Promise((done) => {
    const w = document.createElement("div");
    w.style.cssText = "position:fixed;inset:0;background:#000;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px";
    w.innerHTML = `<video playsinline muted style="max-width:100%;max-height:72vh;border-radius:12px"></video><div style="color:#fff;font-size:15px;text-align:center;padding:0 16px">Point the camera at the QR code</div><button class="btn btn-outline" style="background:#fff">Cancel</button>`;
    document.body.appendChild(w);
    const v = w.querySelector("video"),
      cv = document.createElement("canvas"),
      cx = cv.getContext("2d", { willReadFrequently: true });
    let live = true;
    const end = (val) => {
      if (!live) return;
      live = false;
      stream.getTracks().forEach((t) => t.stop());
      w.remove();
      done(val);
    };
    w.querySelector("button").onclick = () => end(null);
    v.srcObject = stream;
    v.play().catch(() => {});
    const tick = () => {
      if (!live) return;
      if (v.videoWidth) {
        const k = Math.min(1, 640 / v.videoWidth);
        cv.width = v.videoWidth * k;
        cv.height = v.videoHeight * k;
        cx.drawImage(v, 0, 0, cv.width, cv.height);
        const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
        if (r && r.data) return end(r.data);
      }
      setTimeout(tick, 160);
    };
    tick();
  });
}
// scan a sign-in QR on a login screen: fill and submit when it is for this app, otherwise say which app it is for
async function scanLogin(kind, fill) {
  try {
    const t = await scanQR();
    if (!t) return;
    const c = parseLoginQR(t),
      names = { cmd: "Command Center", room: "Situation Room", obs: "Observer" };
    if (!c) return toast("❌ That is not a sign-in QR code");
    if (c.kind != kind) return toast("❌ That QR is for the " + names[c.kind] + " sign-in");
    if (c.origin != ORIGIN) return toast("❌ That QR belongs to another server: " + c.origin);
    fill(c);
  } catch (e) {
    toast("❌ " + e.message);
  }
}
const credText = (c) => [c.title, ...c.lines.map(([k, v]) => k + ": " + v), c.link ? "Sign-in link: " + c.link : ""].filter(Boolean).join("\n");
// one credential: text + QR, with copy / print. c = { title, lines:[[label,value]], link, note }
function credModal(c) {
  document.getElementById("credm")?.remove();
  const w = document.createElement("div");
  w.id = "credm";
  w.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:14px;overflow:auto";
  w.innerHTML = `<div class="card" style="max-width:440px;width:100%;margin:auto;max-height:96vh;overflow:auto"><div class="card-header"><h3><i class="fas fa-qrcode"></i> ${esc(c.title)}</h3></div>
    ${c.lines.map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #edf2f7"><span class="muted">${esc(k)}</span><b class="mono" style="word-break:break-all;text-align:right">${esc(v)}</b></div>`).join("")}
    ${c.link ? `<div style="text-align:center;margin:14px 0 6px">${qrSvg(c.link, 5)}</div><div class="muted" style="text-align:center;font-size:12px">Scan with the phone camera or the app's <b>Scan QR</b> button to sign in — or type the details above.</div>` : ""}
    ${c.note ? `<div class="muted" style="margin-top:10px;font-size:12px">${esc(c.note)}</div>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn btn-primary" id="credc"><i class="fas fa-copy"></i> Copy</button><button class="btn btn-outline" id="credp"><i class="fas fa-print"></i> Print</button><button class="btn btn-outline" id="credd">Done</button></div></div>`;
  document.body.appendChild(w);
  w.querySelector("#credc").onclick = () => {
    navigator.clipboard?.writeText(credText(c));
    toast("📋 Copied — paste it to the recipient");
  };
  w.querySelector("#credp").onclick = () => printCreds(c.title, [c]);
  w.querySelector("#credd").onclick = () => w.remove();
}
// printable sheet of credentials, one card each with its QR (also the way to save them as a PDF)
function printCreds(title, items) {
  const cards = items
    .map(
      (c) =>
        `<div class="c"><div class="q">${c.link ? qrSvg(c.link, 3) : ""}</div><div><h3>${esc(c.title)}</h3>${c.lines.map(([k, v]) => `<div><span>${esc(k)}:</span> <b>${esc(v)}</b></div>`).join("")}<div class="s">Scan to sign in, or open ${esc(ORIGIN.replace(/^https?:\/\//, ""))} and type the details.</div></div></div>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,Arial,sans-serif;margin:16px;color:#1a202c}h1{font-size:18px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}.c{border:1px solid #cbd5e0;border-radius:10px;padding:12px;display:flex;gap:12px;align-items:center;break-inside:avoid}.q svg{display:block}h3{margin:0 0 6px;font-size:14px}div{font-size:13px}span{color:#4a5568}b{font-family:ui-monospace,Menlo,monospace}.s{color:#718096;font-size:11px;margin-top:6px}button{padding:10px 16px;border-radius:8px;border:0;background:#2b6cb0;color:#fff;font-weight:600;margin-bottom:12px}@media print{button{display:none}}</style></head><body><button onclick="print()">Print / Save as PDF</button><h1>${esc(title)}</h1><div class="g">${cards}</div></body></html>`;
  // saved as a file, because browsers block a new window that opens after waiting on the server
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-QR.html";
  a.click();
  toast("📄 QR sheet downloaded — open the file to view, print or save as PDF");
}

// ================= Shared live view (view-only dashboard for people outside the system) =================
let SHARES = null;
async function shareLoad() {
  try {
    SHARES = await A.get("shares");
  } catch {
    SHARES = [];
  }
  render();
}
function tabShare() {
  if (!SHARES) {
    SHARES = [];
    shareLoad();
  }
  const obs = DATA.obs.filter((o) => o.active),
    q = (F.sq || "").toLowerCase(),
    shown = obs.filter((o) => !q || [o.code, o.name, o.lga, o.ward, o.pu, o.pu_name].join(" ").toLowerCase().includes(q)).slice(0, 300);
  window.SHSEL = window.SHSEL || new Set();
  return `<div class="dashboard-grid"><div class="card"><div class="card-header"><h3><i class="fas fa-share-nodes"></i> Share a live view</h3></div>
    <div class="muted" style="margin-bottom:10px">Creates a <b>view-only</b> page — live collation, map and video of the observers you choose — for anyone who has the link <b>and</b> the passcode. Viewers can move between polling units and feeds${CFG.lk ? ", and talk to an observer if you allow it" : ""}. They cannot change anything.</div>
    <input class="fi" id="sh_l" placeholder="Name of this view (e.g. Kano Central – Party HQ)">
    <label class="muted" style="display:block;margin:6px 0"><input type="radio" name="sh_w" value="all" ${window.SHALL !== false ? "checked" : ""} onchange="SHALL=true;render()"> All ${A.role == "room" ? "observers of this room" : "observers of this Command Center"} (new ones are included automatically)</label>
    <label class="muted" style="display:block;margin:6px 0"><input type="radio" name="sh_w" value="pick" ${window.SHALL === false ? "checked" : ""} onchange="SHALL=false;render()"> Only the observers I tick (${SHSEL.size} ticked)</label>
    ${window.SHALL === false ? `<input class="fi" placeholder="Search code, LGA, ward, PU…" value="${esc(F.sq || "")}" onchange="F.sq=this.value;render()"><div style="max-height:240px;overflow:auto;border:1px solid #e2e8f0;border-radius:10px;padding:6px;margin-bottom:10px">${shown.map((o) => `<label style="display:flex;gap:8px;align-items:center;padding:5px 4px;font-size:13px"><input type="checkbox" ${SHSEL.has(o.code) ? "checked" : ""} onchange="this.checked?SHSEL.add('${o.code}'):SHSEL.delete('${o.code}')"><span class="mono">${esc(o.code)}</span><span class="muted">${esc(o.lga)} / ${esc(o.ward)} / PU ${esc(o.pu)}</span></label>`).join("") || '<div class="muted" style="padding:8px">No observers match.</div>'}</div>` : ""}
    <input class="fi" id="sh_p" placeholder="Passcode for viewers (blank = auto-generate)">
    <select class="fi" id="sh_h"><option value="0">Stays open until I revoke it</option><option value="12">Closes after 12 hours</option><option value="24" selected>Closes after 24 hours</option><option value="72">Closes after 3 days</option></select>
    <label class="muted" style="display:block;margin:6px 0 12px"><input type="checkbox" id="sh_t"> Allow viewers to talk to the observer (talk-back audio)</label>
    <button class="btn btn-primary" onclick="shareNew()"><i class="fas fa-share-nodes"></i> Create shared view</button></div>
  <div class="card"><div class="card-header"><h3><i class="fas fa-eye"></i> Shared views (${SHARES.length})</h3><button class="btn btn-sm btn-outline" onclick="shareLoad()"><i class="fas fa-rotate"></i></button></div><div class="tw"><table><tr><th>Name</th><th>Shows</th><th>Talk-back</th><th>Status</th><th>Created</th><th></th></tr>${SHARES.map((s) => `<tr><td><b>${esc(s.label)}</b><br><span class="muted">${esc(s.created_by || "")}</span></td><td>${s.observers == null ? "All" + (s.room_id ? " in " + esc(s.room_id) : "") : s.observers + " observers"}</td><td>${s.talkback ? "Yes" : "No"}</td><td>${pill(s.active ? "active" : "inactive")}${s.expires_at && s.active ? `<br><span class="muted" style="font-size:11px">until ${DT(s.expires_at)}</span>` : ""}</td><td>${DT(s.created_at)}</td><td>${s.active ? `<button class="btn btn-sm btn-outline" onclick="navigator.clipboard?.writeText('${ORIGIN}/share/#${s.token}');toast('Link copied (the passcode is not included)')">Copy link</button> <button class="btn btn-sm btn-danger" onclick="shareRevoke('${s.token}')">Revoke</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">Nothing shared yet.</td></tr>'}</table></div><div class="muted" style="margin-top:8px;font-size:12px">The passcode is shown once, when the view is created. Revoke a view to cut off everyone using it at once.</div></div></div>`;
}
async function shareNew() {
  const pick = window.SHALL === false;
  if (pick && !SHSEL.size) return toast("⚠️ Tick at least one observer, or choose All.");
  try {
    const r = await A.post("shares", {
      label: $("#sh_l").value,
      codes: pick ? [...SHSEL] : null,
      room: A.role == "cmd" && DRILL ? DRILL : null,
      pass: $("#sh_p").value.trim(),
      hours: +$("#sh_h").value,
      talkback: $("#sh_t").checked,
    });
    SHSEL.clear();
    const link = ORIGIN + r.path;
    credModal({ title: r.label + " — live view", lines: [["Link", link], ["Passcode", r.passcode]], link, note: "Send the link and the passcode to your viewers (ideally by different channels). The QR opens the link; the passcode is still asked for." });
    shareLoad();
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
async function shareRevoke(t) {
  if (!confirm("Revoke this shared view? Everyone using it is cut off.")) return;
  await A.post("shares/" + t + "/revoke").catch((e) => toast("⚠️ " + e.message));
  shareLoad();
}

// ================= Help: the manuals, inside the app =================
let HELP = {},
  HELPSEL = "operator";
async function helpLoad(n) {
  try {
    HELP[n] = await A.get("help/" + n);
  } catch (e) {
    HELP[n] = { title: "Manual", html: "<p>Could not load the manual: " + esc(e.message) + "</p>" };
  }
  render();
}
function tabHelp() {
  const su = A.role == "cmd" && ME.su,
    n = su ? HELPSEL : "operator";
  if (!HELP[n]) {
    HELP[n] = { title: "Loading…", html: "<p>Loading the manual…</p>" };
    helpLoad(n);
  }
  const g = HELP[n];
  return `<div class="card"><div class="card-header"><h3><i class="fas fa-circle-question"></i> ${esc(g.title)}</h3><div style="display:flex;gap:8px;flex-wrap:wrap">${su ? `<button class="btn btn-sm ${n == "admin" ? "btn-primary" : "btn-outline"}" onclick="HELPSEL='admin';render()">Administrator manual</button><button class="btn btn-sm ${n == "operator" ? "btn-primary" : "btn-outline"}" onclick="HELPSEL='operator';render()">Operator manual</button>` : ""}${g.pdf ? `<button class="btn btn-sm btn-outline" onclick="A.dl('help/${n}/pdf','${n == "admin" ? "Administrator" : "Operator"}-Manual.pdf')"><i class="fas fa-file-pdf"></i> Download PDF</button>` : ""}</div></div><div class="manual">${g.html}</div></div>`;
}


// ================= Radio: switch the listening post on/off and tune it; listen live =================
let RAUTO = localStorage.getItem("radioAuto") == "1",
  RLAST = null,
  RQ = [],
  RPLAY = false;
const radioListenBtn = () =>
  `<button class="btn btn-sm ${RAUTO ? "btn-success" : "btn-outline"}" style="${RAUTO ? "" : "background:transparent;color:#a0aec0;border-color:#4a5568"}" onclick="radioAutoToggle()" title="Play new transmissions as they arrive"><i class="fas fa-volume-${RAUTO ? "high" : "xmark"}"></i> Listen live: ${RAUTO ? "ON" : "OFF"}</button>`;
function radioAutoToggle() {
  RAUTO = !RAUTO;
  localStorage.setItem("radioAuto", RAUTO ? "1" : "0");
  RLAST = Math.max(0, ...(DATA.radio || []).map((x) => x.id));
  RQ = [];
  if (RAUTO) toast("🔊 Listening live — each new transmission plays as it arrives");
  render();
}
function radioAuto() {
  const ids = (DATA.radio || []).map((x) => x.id),
    top = Math.max(0, ...ids);
  if (RLAST === null || !RAUTO) return void (RLAST = top);
  const fresh = DATA.radio.filter((x) => x.has_audio && x.id > RLAST).sort((a, b) => a.id - b.id);
  RLAST = Math.max(RLAST, top);
  fresh.forEach((x) => RQ.push(x.id));
  radioNext();
}
async function radioNext() {
  if (RPLAY || !RQ.length) return;
  RPLAY = true;
  const done = () => ((RPLAY = false), radioNext());
  try {
    const a = new Audio(URL.createObjectURL(await A.get("radio/" + RQ.shift() + "/audio")));
    a.onended = a.onerror = done;
    await a.play();
  } catch {
    done();
  }
}
async function radioSet(patch) {
  try {
    DATA.rctl = await A.post("radio/control", { ...patch, room: A.role == "cmd" ? F.radioRoom : undefined });
    render();
  } catch (e) {
    toast("⚠️ " + e.message);
  }
}
const radioFreq = () => parseFloat($("#rc_f")?.value) || DATA.rctl?.freq;
function radioStep(d) {
  const f = radioFreq();
  if (!f) return toast("⚠️ Type a frequency first");
  radioSet({ freq: Math.round((f + d) * 10000) / 10000 });
}
function radioTune() {
  const f = parseFloat($("#rc_f").value);
  if (!f) return toast("⚠️ Type a frequency in MHz, e.g. 154.3500");
  radioSet({ freq: f, mode: $("#rc_m").value });
}
function radioSavePreset() {
  const f = radioFreq();
  if (!f) return toast("⚠️ Type a frequency first");
  const n = prompt("Name this channel (e.g. Police Kano North):", "");
  if (n) radioSet({ presets: [...(DATA.rctl.presets || []), { name: n, freq: f }] });
}
function cardRadioCtl() {
  const c = DATA.rctl;
  if (!c) return A.role == "cmd" && !DRILL ? '<div class="muted" style="margin-bottom:10px"><i class="fas fa-circle-info"></i> Choose a room above to switch its radio on or off and tune it.</div>' : "";
  const g = c.gw || {},
    tuned = c.online && g.running && g.freq && c.freq != null && Math.abs(parseFloat(g.freq) - c.freq) < 0.0001,
    st = !c.online
      ? '<span class="pill r">Listening post offline</span>'
      : g.error
        ? '<span class="pill r">' + esc(g.error) + "</span>"
        : !c.power
          ? '<span class="pill s">Online · radio off</span>'
          : tuned
            ? '<span class="pill g">● Receiving ' + c.freq.toFixed(4) + " MHz</span>"
            : '<span class="pill a">Retuning…</span>';
  return `<div class="card" style="margin-bottom:14px"><div class="card-header"><h3><i class="fas fa-radio"></i> Radio receiver</h3>${st}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><button class="btn ${c.power ? "btn-success" : "btn-outline"}" style="min-width:96px" onclick="radioSet({power:${!c.power}})" title="Switch the listening post's radio on or off"><i class="fas fa-power-off"></i> ${c.power ? "ON" : "OFF"}</button>
      <button class="btn btn-sm btn-outline" onclick="radioStep(-0.025)">◀ 25k</button><button class="btn btn-sm btn-outline" onclick="radioStep(-0.0125)">◀ 12.5k</button>
      <input class="fi" id="rc_f" type="number" step="0.0125" min="25" max="1700" inputmode="decimal" placeholder="MHz" value="${c.freq != null ? c.freq.toFixed(4) : ""}" style="width:130px;flex:none;margin:0;font-weight:700;font-size:16px" onkeydown="event.key=='Enter'&&radioTune()">
      <button class="btn btn-sm btn-outline" onclick="radioStep(0.0125)">12.5k ▶</button><button class="btn btn-sm btn-outline" onclick="radioStep(0.025)">25k ▶</button>
      <select class="fi" id="rc_m" style="width:auto;flex:none;margin:0" onchange="radioSet({mode:this.value})"><option value="fm" ${c.mode == "fm" ? "selected" : ""}>Narrow FM (voice)</option><option value="am" ${c.mode == "am" ? "selected" : ""}>AM</option><option value="wbfm" ${c.mode == "wbfm" ? "selected" : ""}>Wide FM</option></select>
      <button class="btn btn-primary" onclick="radioTune()"><i class="fas fa-sliders"></i> Tune</button></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px"><span class="muted">Squelch <b id="rc_sv">${c.squelch}</b></span><input id="rc_s" type="range" min="0" max="150" step="5" value="${c.squelch}" style="flex:1;min-width:140px" oninput="$('#rc_sv').textContent=this.value" onchange="radioSet({squelch:+this.value})"><span class="muted" style="font-size:11px">higher = ignores weaker signals</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${(c.presets || []).map((p, i) => `<span class="tag" style="cursor:pointer" onclick="radioSet({freq:${p.freq}})" title="Tune to ${p.freq.toFixed(4)} MHz">${esc(p.name)} · ${p.freq.toFixed(4)} <b onclick="event.stopPropagation();radioSet({presets:DATA.rctl.presets.filter((_, j) => j != ${i})})" title="Remove" style="margin-left:4px">×</b></span>`).join("")}<button class="btn btn-sm btn-outline" onclick="radioSavePreset()">☆ Save this channel</button></div>
    <div class="muted" style="margin-top:8px;font-size:12px">Nigerian bands: VHF 138–174 MHz, UHF 403–470 MHz. Changes reach the listening post (RTL-SDR + antenna running <code>tuner.js</code>) within about 5 seconds, and what it hears appears below. Only monitor channels you are authorised to monitor.</div></div>`;
}


// ================= Dark / light mode (every dashboard) =================
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("theme", t);
  } catch {}
  const b = document.getElementById("themeBtn");
  if (b) b.innerHTML = t == "dark" ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
}
const toggleTheme = () => applyTheme(document.documentElement.getAttribute("data-theme") == "dark" ? "light" : "dark");
(() => {
  if (window.NO_THEME) return;
  let t = "light";
  try {
    t = localStorage.getItem("theme") || "light";
  } catch {}
  const b = document.createElement("button");
  b.id = "themeBtn";
  b.title = "Dark / light mode";
  b.setAttribute("aria-label", "Dark / light mode");
  b.onclick = toggleTheme;
  document.body.appendChild(b);
  applyTheme(t);
})();
