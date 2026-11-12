const {q,qsys,bcrypt,jwt,SECRET,PARTIES,STATES,rnd,aud,h,app,rate,auth} = require("../core");
const { puList } = require("./results");
// ---- Collation Officers: ward (1), LGA (2) and state (3) supervisors who collect the tallies coming up from
// the polling units, confirm or correct each figure ONCE, and separately record the result sheets / boxes that
// physically arrive at their collation centre (Report B). Everything is scoped to one Command Center.
const LEVELS = { ward: 1, lga: 2, state: 3 };
const cname = (l) => "Collation Officer " + LEVELS[l];
const clean = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const num = (v) => (Number.isFinite(+v) && +v >= 0 && +v <= 10000000 ? Math.round(+v) : null);
// officer sign-in code: CO1-XXXXXX (ward) / CO2- (LGA) / CO3- (state)
async function mk(tn, o) {
  const level = o.level;
  if (!LEVELS[level]) throw Object.assign(new Error("Level must be ward, lga or state"), { status: 400 });
  const [t] = await qsys("select state from tenants where id=$1", [tn]);
  const state = t?.state || clean(o.state, 40);
  if (!STATES.includes(state)) throw Object.assign(new Error("Choose the state this officer covers"), { status: 400 });
  const lga = level == "state" ? "" : clean(o.lga, 80),
    ward = level == "ward" ? clean(o.ward, 80) : "";
  if (level != "state" && !lga) throw Object.assign(new Error("Choose the LGA"), { status: 400 });
  if (level == "ward" && !ward) throw Object.assign(new Error("Choose the ward"), { status: 400 });
  const name = clean(o.name, 80);
  if (!name) throw Object.assign(new Error("Name is required"), { status: 400 });
  const code = "CO" + LEVELS[level] + "-" + rnd(6),
    pass = rnd(8);
  const [r] = await qsys(
    "insert into officers(tenant,level,name,phone,state,lga,ward,code,pass_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [tn, level, name, clean(o.phone, 40), state, lga, ward, code, await bcrypt.hash(pass, 10)],
  );
  return { id: r.id, code, passcode: pass, level, title: cname(level), name, state, lga, ward };
}
const pub = (o) => ({ id: o.id, level: o.level, title: cname(o.level), name: o.name, phone: o.phone, state: o.state, lga: o.lga, ward: o.ward, code: o.code, active: o.active, seen: o.seen });
app.post("/api/login/officer", rate, h(async (req, res) => {
  const [o] = await q("select o.*,t.active ta from officers o join tenants t on t.id=o.tenant where upper(o.code)=upper($1)", [clean(req.body.code, 30)]);
  if (!o || !(await bcrypt.compare(String(req.body.pass || ""), o.pass_hash))) return res.status(401).json({ error: "Invalid officer code or passcode" });
  if (!o.active || !o.ta) return res.status(403).json({ error: "This officer account is switched off" });
  await qsys("update officers set seen=now() where id=$1", [o.id]);
  res.json({ token: jwt.sign({ role: "officer", id: o.id }, SECRET, { expiresIn: "12h" }), officer: pub(o) });
}));
// ---- Command Center: manage officers ----
app.get("/api/officers", auth("cmd", "room"), h(async (req, res) => {
  const l = await q("select o.*,(select count(*)::int from officer_confirms c where c.officer_id=o.id) confirmed,(select count(*)::int from officer_manual m where m.officer_id=o.id) manual from officers o order by level,state,lga,ward,name");
  res.json(l.map((o) => ({ ...pub(o), confirmed: o.confirmed, manual: o.manual })));
}));
app.post("/api/officers", auth("cmd", "room"), h(async (req, res) => {
  try {
    const b = req.body || {};
    if (req.u.role == "room") {
      // a Situation Room adds Ward / LGA officers inside its own LGAs only
      const [r] = await q("select state,scope from rooms where id=$1", [req.u.id]),
        mineL = String(r?.scope || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (b.level == "state") return res.status(403).json({ error: "The state officer is added by the Command Center" });
      if (mineL.length && !mineL.includes(String(b.lga || "").trim().toLowerCase())) return res.status(403).json({ error: "That LGA is not in this room" });
      b.state = r.state;
    }
    const o = await mk(req.u.tn, b);
    aud("CMD", "Added " + o.title + " " + o.name + " (" + o.code + ")");
    res.json(o);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));
app.post("/api/officers/:id/reset", auth("cmd"), h(async (req, res) => {
  const p = rnd(8),
    r = await q("update officers set pass_hash=$2 where id=$1 returning code,name", [+req.params.id, await bcrypt.hash(p, 10)]);
  if (!r.length) return res.status(404).json({ error: "Not found" });
  aud("CMD", "Reset passcode for officer " + r[0].code);
  res.json({ code: r[0].code, passcode: p });
}));
app.post("/api/officers/:id/active", auth("cmd"), h(async (req, res) => {
  const r = await q("update officers set active=$2 where id=$1 returning code", [+req.params.id, !!req.body.active]);
  if (!r.length) return res.status(404).json({ error: "Not found" });
  aud("CMD", (req.body.active ? "Enabled" : "Disabled") + " officer " + r[0].code);
  res.json({ ok: 1 });
}));
app.delete("/api/officers/:id", auth("cmd"), h(async (req, res) => {
  const r = await q("delete from officers where id=$1 returning code", [+req.params.id]);
  if (!r.length) return res.status(404).json({ error: "Not found" });
  aud("CMD", "Removed officer " + r[0].code);
  res.json({ ok: 1 });
}));
// what the officers have confirmed / entered — the Command Center's view
app.get("/api/officers/records", auth("cmd"), h(async (req, res) => {
  res.json({
    confirms: await q("select c.ckey,c.act,c.fig,c.orig,c.ts,o.name,o.level,o.code from officer_confirms c join officers o on o.id=c.officer_id order by c.ts desc limit 500"),
    manual: await q("select m.area,m.fig,m.boxes,m.note,m.revs,m.ts,o.name,o.level,o.code from officer_manual m join officers o on o.id=m.officer_id order by m.ts desc limit 500"),
  });
}));
// ---- the officer's own app ----
const sum = (l) => {
  const t = {};
  l.forEach((f) => f && Object.entries(f).forEach(([p, v]) => (t[p] = (t[p] || 0) + (+v || 0))));
  return t;
};
// Report A — every unit under this officer: polling units (ward officer), wards (LGA officer), LGAs (state officer).
// A polling-unit figure a ward officer has already confirmed/corrected is the one the levels above collect.
async function fetchUnits(req) {
  const o = req.u.off,
    f = { state: o.state };
  if (o.lga) f.lga = o.lga;
  if (o.ward) f.ward = o.ward;
  const pus = await puList({ role: "cmd", tn: req.u.tn, id: "officer" }, f),
    pc = await q("select c.ckey,c.act,c.fig,c.ts,o.name,o.level from officer_confirms c join officers o on o.id=c.officer_id where o.level='ward'"),
    PC = Object.fromEntries(pc.map((c) => [c.ckey.replace(/^pu:/, ""), c])),
    mine = await q("select ckey,act,fig,orig,ts from officer_confirms where officer_id=$1", [o.id]),
    M = Object.fromEntries(mine.map((c) => [c.ckey, c])),
    man = await q("select area,fig,boxes,note,revs,ts from officer_manual where officer_id=$1", [o.id]),
    MA = Object.fromEntries(man.map((c) => [c.area, c]));
  const eff = (x) => (PC[x.key] ? PC[x.key].fig : x.fig); // wards' confirmed figure wins over the raw observer figure
  const units = {};
  const add = (key, label, x) => {
    const u = (units[key] = units[key] || { key, label, contest: x.contest, state: x.state, lga: x.lga, ward: x.ward, pus: 0, reporting: 0, disputed: 0, verified: 0, figs: [], pu: null });
    u.pus++;
    if (x.fig || PC[x.key]) u.reporting++;
    if (x.status == "disputed") u.disputed++;
    if (x.verified) u.verified++;
    u.figs.push(eff(x));
    return u;
  };
  for (const x of pus) {
    const ck = x.contest;
    if (o.level == "ward") {
      const u = add("pu:" + x.key, (x.pu_name || x.pu) + " · " + x.pu, x);
      u.pu = { code: x.pu, status: x.status, obs: x.obs.length, anomaly: x.anomaly, ec8a: x.ec8a, wardConf: PC[x.key] ? { by: PC[x.key].name, act: PC[x.key].act } : null, raw: x.fig };
    } else if (o.level == "lga") add("ward:" + [x.state, x.lga, x.ward, ck].join("|"), x.ward, x);
    else add("lga:" + [x.state, x.lga, ck].join("|"), x.lga, x);
  }
  // The officer's whole area from the state's location list, even where no observer has reported yet
  const lw = ["state=$1"], la = [o.state];
  if (o.lga) (la.push(o.lga), lw.push("lga=$" + la.length));
  if (o.ward) (la.push(o.ward), lw.push("ward=$" + la.length));
  const locs = await q("select lga,ward,pu,name from locations where " + lw.join(" and ") + " order by lga,ward,pu", la),
    nz = (v) => String(v == null ? "" : v).replace(/^0+(?=.)/, ""),
    covered = new Set(pus.map((x) => [x.lga, x.ward, nz(x.pu)].join("|"))),
    count = {};
  for (const r of locs) {
    const area = o.level == "ward" ? null : o.level == "lga" ? "ward:" + [o.state, r.lga, r.ward].join("|") : "lga:" + [o.state, r.lga].join("|");
    if (area) count[area] = (count[area] || 0) + 1;
    if (covered.has([r.lga, r.ward, nz(r.pu)].join("|"))) continue;
    const x = { key: [o.state, r.lga, r.ward, r.pu, "general"].join("|"), contest: "", state: o.state, lga: r.lga, ward: r.ward, pu: r.pu, pu_name: r.name, status: "pending", fig: null, verified: false, obs: [], anomaly: false, ec8a: 0 };
    if (o.level == "ward") {
      const u = add("pu:" + x.key, (r.name || r.pu) + " · " + r.pu, x);
      u.pu = { code: r.pu, status: "pending", obs: 0, anomaly: false, ec8a: 0, wardConf: null, raw: null };
    } else if (o.level == "lga") add("ward:" + [o.state, r.lga, r.ward, ""].join("|"), r.ward, x);
    else add("lga:" + [o.state, r.lga, ""].join("|"), r.lga, x);
  }
  // an area with no report at all shows once; one with contests shows per contest and is not duplicated by an empty line
  const reported = new Set(Object.values(units).filter((u) => u.contest).map((u) => u.key.replace(/\|[^|]*$/, "")));
  for (const k of Object.keys(units)) if (!units[k].contest && reported.has(k.replace(/\|[^|]*$/, ""))) delete units[k];
  for (const u of Object.values(units)) {
    const ck = u.key.startsWith("pu:") ? null : u.key.replace(/\|[^|]*$/, "");
    if (ck && count[ck] > u.pus) u.pus = count[ck];
  }
  const out = Object.values(units)
    .map((u) => {
      const fig = sum(u.figs),
        mineRec = M[u.key] || null,
        man = MA[u.key] || null;
      delete u.figs;
      return {
        ...u,
        fig,
        total: Object.values(fig).reduce((a, b) => a + b, 0),
        mine: mineRec,
        manual: man,
        // Report B against Report A: any party where the physical result differs from what was reported
        diff: man ? Object.keys({ ...fig, ...man.fig }).filter((p) => (fig[p] || 0) != (man.fig[p] || 0)) : null,
      };
    })
    .sort((a, b) => (a.label || "").localeCompare(b.label || "") || (a.contest || "").localeCompare(b.contest || ""));
  return { officer: pub(o), parties: PARTIES, units: out };
}
app.get("/api/officer/units", auth("officer"), h(async (req, res) => res.json(await fetchUnits(req))));
// confirm (as is) or correct — each unit ONCE per officer
app.post("/api/officer/confirm", auth("officer"), h(async (req, res) => {
  const o = req.u.off,
    key = clean(req.body.key, 300),
    u = (await fetchUnits(req)).units.find((x) => x.key == key);
  if (!u) return res.status(404).json({ error: "That unit is not under your area" });
  if (u.mine) return res.status(409).json({ error: "You already " + (u.mine.act == "confirm" ? "confirmed" : "corrected") + " this one — it can only be done once" });
  let fig = u.fig,
    act = "confirm";
  if (req.body.fig) {
    fig = {};
    for (const [p, v] of Object.entries(req.body.fig)) {
      if (!PARTIES.includes(p)) continue;
      const n = num(v);
      if (n == null) return res.status(400).json({ error: "Invalid figure for " + p });
      fig[p] = n;
    }
    if (!Object.keys(fig).length) return res.status(400).json({ error: "Enter at least one figure" });
    act = "correct";
  } else if (!Object.keys(fig).length) return res.status(400).json({ error: "Nothing has been reported here yet to confirm" });
  await q("insert into officer_confirms(tenant,officer_id,ckey,act,fig,orig) values($1,$2,$3,$4,$5,$6)", [req.u.tn, o.id, key, act, fig, u.fig]);
  aud("CMD", cname(o.level) + " " + o.name + " " + act + "ed " + key, req.u.tn);
  res.json({ ok: 1, act });
}));
// Report B — the physical result sheet / boxes that arrived at the collation centre (can be re-entered; revisions are counted)
app.post("/api/officer/manual", auth("officer"), h(async (req, res) => {
  const o = req.u.off,
    key = clean(req.body.key, 300),
    u = (await fetchUnits(req)).units.find((x) => x.key == key);
  if (!u) return res.status(404).json({ error: "That unit is not under your area" });
  const fig = {};
  for (const [p, v] of Object.entries(req.body.fig || {})) {
    if (!PARTIES.includes(p) || v === "" || v == null) continue;
    const n = num(v);
    if (n == null) return res.status(400).json({ error: "Invalid figure for " + p });
    fig[p] = n;
  }
  if (!Object.keys(fig).length) return res.status(400).json({ error: "Enter the figures from the result sheet" });
  const boxes = req.body.boxes === "" || req.body.boxes == null ? null : num(req.body.boxes);
  await q(
    "insert into officer_manual(tenant,officer_id,area,fig,boxes,note) values($1,$2,$3,$4,$5,$6) on conflict(officer_id,area) do update set fig=$4,boxes=$5,note=$6,revs=officer_manual.revs+1,ts=now()",
    [req.u.tn, o.id, key, fig, boxes, clean(req.body.note, 300)],
  );
  aud("CMD", cname(o.level) + " " + o.name + " recorded the physical result for " + key, req.u.tn);
  res.json({ ok: 1 });
}));
module.exports = { mk, LEVELS };
