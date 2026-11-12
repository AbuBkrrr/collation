const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- Results: two observers per PU are reconciled; a room supervisor resolves disputes; EC8A photo proves it ----
// PU status: pending (nothing yet) · single (1 observer) · partial (2+, no conflicting figure, still entering)
//            matched (2+ identical) · disputed (2+ conflict: NOT counted until resolved) · resolved (supervisor)
// verified = (matched or resolved) and at least one EC8A photo uploaded.
const LV = ["state", "lga", "ward", "pu"];
const pkey = (o) => [o.state, o.lga, o.ward, o.pu].join("|");
const cache = new Map();
bus.dirty = () => cache.clear();
async function puList(u, f) {
  const ck = JSON.stringify([u.tn, u.role, u.id, f]),
    hit_ = cache.get(ck);
  if (hit_ && Date.now() - hit_.t < 2000) return hit_.v;
  const w = ["o.active", "o.room_id in (select id from rooms where not coalesce(archived,false))"],
    a = [];
  const add = (c, v) => {
    a.push(v);
    w.push(c + "=$" + a.length);
  };
  if (u.role == "room") add("o.room_id", u.id);
  else if (f.room) add("o.room_id", f.room);
  LV.forEach((k) => f[k] && add("o." + k, String(f[k])));
  const obs = await q(
    "select o.code,o.name,o.room_id,o.state,o.lga,o.ward,o.pu,o.pu_name,o.reg,o.ec_reg,o.ec_acc from observers o where " +
      w.join(" and "),
    a,
  );
  const codes = obs.map((o) => o.code),
    rooms = [...new Set(obs.map((o) => o.room_id))];
  const [tl, rs, ph] = await Promise.all([
    q("select code,party,v,edits from tallies where code=any($1)", [codes]),
    q("select * from pu_results where room_id=any($1)", [rooms]),
    q("select id,code,state,lga,ward,pu,ts,sha256 from ec8a where room_id=any($1) order by id", [rooms]),
  ]);
  const T = {};
  tl.forEach((x) => ((T[x.code] = T[x.code] || {})[x.party] = x.v));
  const R = Object.fromEntries(rs.map((r) => [pkey(r), r])),
    P = {};
  ph.forEach((x) => (P[pkey(x)] = P[pkey(x)] || []).push(x));
  const G = {};
  obs.forEach((o) => (G[pkey(o)] = G[pkey(o)] || []).push(o));
  const out = Object.entries(G).map(([k, l]) => {
    const subs = l.filter((o) => T[o.code] && Object.keys(T[o.code]).length),
      res = R[k];
    let status, fig = null;
    if (res) {
      status = "resolved";
      fig = res.final;
    } else if (!subs.length) status = "pending";
    else if (subs.length == 1) {
      status = "single";
      fig = T[subs[0].code];
    } else {
      const ps = [...new Set(subs.flatMap((o) => Object.keys(T[o.code])))];
      const conflict = ps.some((p) => new Set(subs.filter((o) => p in T[o.code]).map((o) => T[o.code][p])).size > 1);
      const full = ps.every((p) => subs.every((o) => p in T[o.code]));
      status = conflict ? "disputed" : full ? "matched" : "partial";
      if (!conflict) fig = Object.assign({}, ...subs.map((o) => T[o.code]));
    }
    const o0 = l[0],
      total = fig ? Object.values(fig).reduce((s, v) => s + v, 0) : 0,
      photos = P[k] || [],
      // voters on register / accredited (BVAS) as read off the EC8A by the observers; room's figure as fallback
      ecr = l.map((o) => o.ec_reg).filter((v) => v != null),
      eca = l.map((o) => o.ec_acc).filter((v) => v != null),
      reg = ecr.length ? Math.max(...ecr) : o0.reg,
      acc = eca.length ? Math.max(...eca) : null;
    return {
      key: k,
      room_id: o0.room_id,
      state: o0.state,
      lga: o0.lga,
      ward: o0.ward,
      pu: o0.pu,
      pu_name: o0.pu_name,
      reg,
      acc,
      sheetConflict: new Set(ecr).size > 1 || new Set(eca).size > 1,
      status,
      fig,
      total,
      // over-voting: votes above accredited voters (INEC rule), or above registered voters when not known
      anomaly: total > (acc ?? reg),
      ec8a: photos.length,
      verified: (status == "matched" || status == "resolved") && photos.length > 0,
      obs: l.map((o) => ({ code: o.code, name: o.name, t: T[o.code] || {}, ec_reg: o.ec_reg, ec_acc: o.ec_acc })),
      photos,
      res: res ? { by: res.by_who, note: res.note, ts: res.ts, src: res.src } : null,
    };
  });
  cache.set(ck, { t: Date.now(), v: out });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return out;
}
const POOL_RANK = { pending: 0, disputed: 1, single: 2, partial: 3, matched: 4, resolved: 5 };
const poolScore = (x) => (x.fig ? 10 : 0) + (x.verified ? 6 : POOL_RANK[x.status] || 0);
const filt = (qq) => Object.fromEntries(["room", ...LV].filter((k) => qq[k]).map((k) => [k, String(qq[k])]));
const blank = () => ({ pus: 0, pending: 0, single: 0, partial: 0, matched: 0, disputed: 0, resolved: 0, verified: 0, anomaly: 0, ec8a: 0 });
function agg(l) {
  const t = Object.fromEntries(PARTIES.map((p) => [p, 0])),
    c = blank();
  l.forEach((x) => {
    c.pus++;
    c[x.status]++;
    if (x.verified) c.verified++;
    if (x.anomaly) c.anomaly++;
    if (x.ec8a) c.ec8a++;
    if (x.fig) for (const [p, v] of Object.entries(x.fig)) t[p] = (t[p] || 0) + v;
  });
  return { totals: t, counts: c, total: Object.values(t).reduce((a, b) => a + b, 0) };
}
// GET /api/collation?level=nat|state|lga|ward|pu&state=&lga=&ward=&pu=&room=
app.get(
  "/api/collation",
  auth("cmd", "room"),
  h(async (req, res) => {
    const f = filt(req.query),
      lvl = LV.includes(req.query.level) ? req.query.level : "nat";
    if (f.room && req.u.role == "cmd" && !(await mine(req.u, f.room))) return res.sendStatus(403);
    let l = await puList(req.u, f),
      pooled = null,
      scope = null,
      states = null;
    // Platform administrator: every state and every active Command Center, vote counts only. The search lists
    // (scope) are built from the unfiltered data so choosing a state does not hide the other states.
    if (req.u.role == "cmd" && req.u.su && req.query.pool == "1" && !f.room) {
      const ts = await qsys("select id from tenants where active and not coalesce(archived,false)"),
        match = (x) => LV.every((k) => !f[k] || String(x[k]) == f[k]),
        best = new Map(),
        keys = new Set();
      const take = (x, own) => {
        keys.add(x.key);
        if (!match(x)) return;
        const cur = best.get(x.key);
        if (!cur || (!(cur.own && cur.x.fig) && poolScore(x) > poolScore(cur.x))) best.set(x.key, { x, own });
      };
      (await puList(req.u, {})).forEach((x) => take(x, true));
      for (const t of ts) {
        if (t.id == req.u.tn) continue;
        (await als.run({ name: "pool", tn: t.id, room: "" }, () => puList({ role: "cmd", tn: t.id, id: "pool" }, {}))).forEach((x) => take(x, false));
      }
      const all = [...best.values()],
        ext = all.filter((b) => !b.own);
      l = all.map((b) => b.x);
      scope = [...keys].slice(0, 40000);
      states = (await qsys("select state from tenants where state is not null and active and not coalesce(archived,false) union select state from rooms where state is not null and not coalesce(archived,false)")).map((r) => r.state);
      pooled = { all: true, state: null, lga: null, centres: ts.length, extPus: ext.length, extVotes: ext.reduce((s, b) => s + (b.x.total || 0), 0) };
    }
    // State-wide view (Global Collation of a Command Center): vote counts of every pooled Command Center
    // of the same state, one figure per polling unit. Only these aggregates leave another command -
    // never its observers, codes, photos, video, audio or map positions.
    else if (req.query.pool == "1" && !f.room) {
      const [me] = await qsys("select state,pool from tenants where id=$1", [req.u.tn]);
      if (me?.state && me.pool) {
        const isRoom = req.u.role == "room",
          others = await qsys("select id from tenants where state=$1 and pool and active and id<>$2", [me.state, req.u.tn]);
        // a Situation Room sees the whole of its own LGA(s): its sister rooms in this Command Center
        // and the rooms of the other pooled Command Centers that cover the same LGA
        const [rm] = isRoom ? await qsys("select scope from rooms where id=$1", [req.u.id]) : [],
          lgas = isRoom ? String(rm?.scope || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) : [],
          inScope = (x) => !lgas.length || lgas.includes(String(x.lga).toLowerCase());
        const RANK = { pending: 0, disputed: 1, single: 2, partial: 3, matched: 4, resolved: 5 };
        const score = (x) => (x.fig ? 10 : 0) + (x.verified ? 6 : RANK[x.status] || 0);
        const best = new Map(l.map((x) => [x.key, { x, own: true }]));
        for (const t of [...(isRoom ? [{ id: req.u.tn }] : []), ...others]) {
          const tl = await als.run({ name: "pool", tn: t.id, room: "" }, () => puList({ role: "cmd", tn: t.id, id: "pool" }, { ...f, state: me.state }));
          for (const x of tl) {
            if (!inScope(x)) continue;
            const cur = best.get(x.key);
            // our own figure for a unit always stands; otherwise the best-evidenced figure is used (never added twice)
            if (!cur || (!(cur.own && cur.x.fig) && score(x) > score(cur.x))) best.set(x.key, { x, own: false });
          }
        }
        const all = [...best.values()],
          ext = all.filter((b) => !b.own);
        l = all.map((b) => b.x);
        pooled = { state: me.state, lga: isRoom && lgas.length ? rm.scope : null, centres: others.length + 1, extPus: ext.length, extVotes: ext.reduce((s, b) => s + (b.x.total || 0), 0) };
      }
    }
    const g = {};
    l.forEach((x) => {
      const k = lvl == "nat" ? "All" : lvl == "pu" ? [x.lga, x.ward, "PU " + x.pu].join(" / ") : x[lvl];
      (g[k] = g[k] || []).push(x);
    });
    res.json({
      parties: PARTIES,
      level: lvl,
      pooled,
      scope,
      states,
      sum: agg(l),
      rows: Object.entries(g)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([k, v]) => ({ key: k, ...agg(v) })),
    });
  }),
);
// GET /api/pus?status=disputed&...  - PU-by-PU detail for reconciliation (max 1000)
app.get(
  "/api/pus",
  auth("cmd", "room"),
  h(async (req, res) => {
    const f = filt(req.query);
    if (f.room && req.u.role == "cmd" && !(await mine(req.u, f.room))) return res.sendStatus(403);
    const order = { disputed: 0, anomaly: 1, partial: 2, single: 3, matched: 4, resolved: 5, pending: 6 };
    let l = await puList(req.u, f);
    if (req.query.status) l = l.filter((x) => x.status == req.query.status || (req.query.status == "unverified" && !x.verified));
    l = [...l].sort((a, b) => (a.anomaly ? 1 : order[a.status]) - (b.anomaly ? 1 : order[b.status]) || a.key.localeCompare(b.key));
    res.json({ count: l.length, items: l.slice(0, 1000) });
  }),
);
// Supervisor (Situation Room) resolves a PU: picks one observer's figures or enters the EC8A figures.
app.post(
  "/api/pus/resolve",
  auth("room"),
  h(async (req, res) => {
    const b = req.body,
      k = Object.fromEntries(LV.map((x) => [x, String(b[x] || "")]));
    if (LV.some((x) => !k[x])) return res.status(400).json({ error: "state, lga, ward and pu are required" });
    const note = String(b.note || "").trim().slice(0, 500);
    if (note.length < 3) return res.status(400).json({ error: "Add a note explaining the decision (e.g. 'matches EC8A')" });
    const fin = {};
    for (const [p, v] of Object.entries(b.final || {})) {
      if (!PARTIES.includes(p) || !Number.isInteger(v) || v < 0 || v > 100000)
        return res.status(400).json({ error: "Invalid figure for " + p });
      fin[p] = v;
    }
    if (!Object.keys(fin).length) return res.status(400).json({ error: "Enter at least one party figure" });
    const [o] = await q("select 1 from observers where room_id=$1 and state=$2 and lga=$3 and ward=$4 and pu=$5 limit 1", [
      req.u.id, k.state, k.lga, k.ward, k.pu,
    ]);
    if (!o) return res.status(404).json({ error: "No observer of this room at that PU" });
    await q(
      "insert into pu_results(room_id,state,lga,ward,pu,final,by_who,note,src) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(room_id,state,lga,ward,pu) do update set final=$6,by_who=$7,note=$8,src=$9,ts=now()",
      [req.u.id, k.state, k.lga, k.ward, k.pu, JSON.stringify(fin), String(b.by || req.u.id).slice(0, 60), note, String(b.src || "manual").slice(0, 40)],
    );
    cache.clear();
    aud(req.u.id, "Resolved PU " + LV.map((x) => k[x]).join("/") + " = " + JSON.stringify(fin) + " · " + note);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/pus/unresolve",
  auth("room"),
  h(async (req, res) => {
    const b = req.body,
      r = await qx("delete from pu_results where room_id=$1 and state=$2 and lga=$3 and ward=$4 and pu=$5", [
        req.u.id, b.state, b.lga, b.ward, b.pu,
      ]);
    if (!r.rowCount) return res.sendStatus(404);
    cache.clear();
    aud(req.u.id, "Reopened PU " + [b.state, b.lga, b.ward, b.pu].join("/"));
    res.json({ ok: 1 });
  }),
);
// EC8A result-sheet photo from the observer (JPEG/PNG/WebP, max 20 MB) - SHA-256 kept as tamper evidence
app.post(
  "/api/observer/ec8a",
  express.raw({ type: "image/*", limit: "20mb" }),
  auth("obs"),
  h(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: "Send the photo as image/jpeg, image/png or image/webp" });
    const ext = { "image/png": "png", "image/webp": "webp" }[req.headers["content-type"]] || "jpg",
      [o] = await q("select * from observers where code=$1", [req.u.id]),
      d = path.join(DATA, "ec8a", o.room_id);
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, o.code + "_" + Date.now() + "_" + rnd(3) + "." + ext),
      sha = crypto.createHash("sha256").update(req.body).digest("hex");
    fs.writeFileSync(f, req.body);
    const [x] = await q(
      "insert into ec8a(code,room_id,state,lga,ward,pu,path,sha256) values($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [o.code, o.room_id, o.state, o.lga, o.ward, o.pu, f, sha],
    );
    cache.clear();
    aud(o.code, "Uploaded EC8A photo " + x.id + " sha256 " + sha.slice(0, 16));
    res.json({ id: x.id, sha256: sha });
  }),
);
// observer types two numbers from the EC8A: voters on register and accredited voters
app.post(
  "/api/observer/sheet",
  auth("obs"),
  h(async (req, res) => {
    const n = (v) => (v === "" || v == null ? null : Number.isInteger(+v) && +v >= 0 && +v <= 100000 ? +v : NaN),
      reg = n(req.body.reg),
      acc = n(req.body.acc);
    if (Number.isNaN(reg) || Number.isNaN(acc)) return res.status(400).json({ error: "Enter whole numbers" });
    if (reg != null && acc != null && acc > reg) return res.status(400).json({ error: "Accredited cannot be more than registered" });
    await q("update observers set ec_reg=coalesce($2,ec_reg),ec_acc=coalesce($3,ec_acc) where code=$1", [req.u.id, reg, acc]);
    aud(req.u.id, "EC8A figures: registered " + reg + ", accredited " + acc);
    res.json({ ok: 1 });
  }),
);
app.get(
  "/api/observer/ec8a",
  auth("obs"),
  h(async (req, res) => res.json(await q("select id,ts,sha256 from ec8a where code=$1 order by id", [req.u.id]))),
);
app.get(
  "/api/ec8a/:id/file",
  auth("cmd", "room"),
  h(async (req, res) => {
    const [x] = await q("select * from ec8a where id=$1", [+req.params.id || 0]);
    if (!x || (req.u.role == "room" && x.room_id != req.u.id)) return res.sendStatus(404);
    res.sendFile(x.path);
  }),
);
module.exports = { puList };
