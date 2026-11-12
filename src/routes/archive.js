const {qsys,als,fs,path,DATA,pool,aud,h,app,auth,su} = require("../core");
const { puList } = require("./results");
// ---- Platform administrator only: archive (hide, keep, restorable) or permanently delete Command Centers,
// Situation Rooms and their election data. Clients can only suspend / deactivate; they cannot archive or delete.
// Deleting a Command Center deletes all its Situation Rooms; deleting a Situation Room deletes all its observers.
// Nothing collected is ever lost silently: before anything is deleted or cleared, a full copy of the data (JSON) and of the
// photos / clips / radio audio is put in the vault (DATA_DIR/archive) and stays there until you remove it on the server. ----
const VAULT = path.join(DATA, "archive");
fs.mkdirSync(VAULT, { recursive: true });
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);
// copy everything about these rooms into the vault; returns { name, media } (media = files to move into the vault folder)
async function snapshot(c, label, tenant, rooms) {
  const rows = async (sql, a) => (await c.query(sql, a)).rows,
    codes = rooms.length ? (await rows("select code from observers where room_id=any($1)", [rooms])).map((x) => x.code) : [];
  const snap = {
    label,
    taken_at: new Date().toISOString(),
    tenant: tenant ? (await rows("select id,name,state,active,archived from tenants where id=$1", [tenant]))[0] || null : null,
    rooms: await rows("select id,name,state,scope,kind,operator,status,tenant,activated_at from rooms where id=any($1)", [rooms]),
    observers: await rows("select code,room_id,name,state,lga,ward,pu,pu_name,reg,ec_reg,ec_acc,active,lat,lng,seen from observers where room_id=any($1)", [rooms]),
    tallies: await rows("select code,party,v,edits,hist from tallies where code=any($1)", [codes]),
    pu_results: await rows("select room_id,state,lga,ward,pu,final,by_who,note,src,ts from pu_results where room_id=any($1)", [rooms]),
    ec8a: await rows("select id,code,room_id,state,lga,ward,pu,path,sha256,ts from ec8a where room_id=any($1)", [rooms]),
    incidents: await rows("select * from incidents where room_id=any($1)", [rooms]),
    radio: await rows("select id,room_id,ts,text,alert,freq,talkgroup,unit from radio where room_id=any($1)", [rooms]),
    contacts: await rows("select * from contacts where room_id=any($1)", [rooms]),
    messages: tenant ? await rows("select id,from_id,to_scope,text,ts,ack from messages where tenant=$1", [tenant]) : [],
    audit: tenant ? await rows("select ts,who,action from audit where tenant=$1", [tenant]) : [],
  };
  const name = stamp() + "_" + safe(label) + ".json";
  fs.writeFileSync(path.join(VAULT, name), JSON.stringify(snap));
  const media = [
    ...snap.ec8a.map((e) => e.path),
    ...(await rows("select path from clips where room_id=any($1)", [rooms])).map((x) => x.path),
    ...(await rows("select audio_path p from radio where room_id=any($1) and audio_path is not null", [rooms])).map((x) => x.p),
  ];
  return { name, media: media.filter(Boolean) };
}
async function wipe(c, rooms, keepRooms) {
  const codes = (await c.query("select code from observers where room_id=any($1)", [rooms])).rows.map((x) => x.code);
  await c.query("delete from tallies where code=any($1)", [codes]);
  for (const t of ["ec8a", "clips", "incidents", "units", "radio", "pu_results", "observers", "contacts"]) await c.query(`delete from ${t} where room_id=any($1)`, [rooms]);
  if (!keepRooms) {
    for (const t of ["radio_keys", "radio_ctl", "shares"]) await c.query(`delete from ${t} where room_id=any($1)`, [rooms]);
    await c.query("delete from rooms where id=any($1)", [rooms]);
  }
}
const tx = async (fn) => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
};
// move the photos / clips / audio into the vault (only after the database change committed)
function keepMedia(snap) {
  const dir = path.join(VAULT, snap.name.replace(/\.json$/, "") + "_media");
  for (const f of snap.media) {
    try {
      if (!fs.existsSync(f)) continue;
      fs.mkdirSync(dir, { recursive: true });
      const to = path.join(dir, path.basename(path.dirname(f)) + "_" + path.basename(f));
      try { fs.renameSync(f, to); } catch { fs.copyFileSync(f, to); fs.rmSync(f, { force: true }); }
    } catch (e) { console.error("vault media:", e.message); }
  }
}
// ---- Command Centers ----
app.post("/api/tenants/:id/archive", auth("cmd"), su, h(async (req, res) => {
  const [t] = await qsys("select * from tenants where id=$1", [req.params.id]);
  if (!t) return res.sendStatus(404);
  if (t.id == req.u.tn) return res.status(400).json({ error: "You cannot archive your own Command Center" });
  const on = !!req.body.on;
  await qsys("update tenants set archived=$2,active=case when $2 then false else active end where id=$1", [t.id, on]);
  if (on) await qsys("update rooms set status='suspended' where tenant=$1 and status='active'", [t.id]);
  aud("CMD", (on ? "Archived " : "Restored ") + "Command Center " + t.id + " (" + t.name + ")");
  res.json({ ok: 1 });
}));
// permanently delete a Command Center AND every Situation Room and observer under it (a copy goes to the vault)
app.post("/api/tenants/:id/delete", auth("cmd"), su, h(async (req, res) => {
  const [t] = await qsys("select * from tenants where id=$1", [req.params.id]);
  if (!t) return res.sendStatus(404);
  if (t.id == req.u.tn) return res.status(400).json({ error: "You cannot delete your own Command Center" });
  if (req.body.confirm !== t.id) return res.status(400).json({ error: "Type the Command Center ID (" + t.id + ") to confirm" });
  const snap = await tx(async (c) => {
    const rooms = (await c.query("select id from rooms where tenant=$1", [t.id])).rows.map((x) => x.id),
      s = await snapshot(c, "command-center_" + t.id + "_" + t.name, t.id, rooms);
    if (rooms.length) await wipe(c, rooms, false);
    for (const q of ["shares where tenant", "contacts where tenant", "messages where tenant", "audit where tenant", "cmd_users where tenant"]) await c.query(`delete from ${q}=$1`, [t.id]);
    await c.query("delete from settings where k like $1", ["%:" + t.id]);
    await c.query("delete from tenants where id=$1", [t.id]);
    return s;
  });
  keepMedia(snap);
  aud("CMD", "Deleted Command Center " + t.id + " (" + t.name + ") with all its rooms and observers; copy kept: " + snap.name);
  res.json({ ok: 1, kept: snap.name });
}));
// delete every Situation Room (and their observers) of a Command Center, keeping the center and its operators
app.post("/api/tenants/:id/delete-rooms", auth("cmd"), su, h(async (req, res) => {
  const [t] = await qsys("select * from tenants where id=$1", [req.params.id]);
  if (!t) return res.sendStatus(404);
  if (req.body.confirm !== t.id) return res.status(400).json({ error: "Type the Command Center ID (" + t.id + ") to confirm" });
  const snap = await tx(async (c) => {
    const rooms = (await c.query("select id from rooms where tenant=$1", [t.id])).rows.map((x) => x.id);
    if (!rooms.length) return null;
    const s = await snapshot(c, "all-rooms_" + t.id, t.id, rooms);
    await wipe(c, rooms, false);
    return s;
  });
  if (snap) keepMedia(snap);
  aud("CMD", "Deleted all Situation Rooms of " + t.id + (snap ? "; copy kept: " + snap.name : " (there were none)"));
  res.json({ ok: 1, kept: snap && snap.name });
}));
// clear a Command Center's election data (observers, results, photos, clips, incidents, radio, messages); keeps the center, its rooms and operators
app.post("/api/tenants/:id/wipe", auth("cmd"), su, h(async (req, res) => {
  const [t] = await qsys("select * from tenants where id=$1", [req.params.id]);
  if (!t) return res.sendStatus(404);
  if (req.body.confirm !== t.id) return res.status(400).json({ error: "Type the Command Center ID (" + t.id + ") to confirm" });
  const snap = await tx(async (c) => {
    const rooms = (await c.query("select id from rooms where tenant=$1", [t.id])).rows.map((x) => x.id),
      s = await snapshot(c, "cleared-data_" + t.id, t.id, rooms);
    if (rooms.length) await wipe(c, rooms, true);
    await c.query("delete from messages where tenant=$1", [t.id]);
    return s;
  });
  keepMedia(snap);
  aud("CMD", "Cleared all election data of Command Center " + t.id + "; copy kept: " + snap.name);
  res.json({ ok: 1, kept: snap.name });
}));
// ---- Situation Rooms (any Command Center) ----
app.get("/api/admin/rooms", auth("cmd"), su, h(async (req, res) =>
  res.json(await qsys("select r.id,r.name,r.state,r.scope,r.kind,r.status,coalesce(r.archived,false) archived,(select count(*)::int from observers where room_id=r.id) obs from rooms r where r.tenant=$1 order by r.archived,r.id", [String(req.query.tenant || "")])),
));
const room = async (req, res) => {
  const [r] = await qsys("select * from rooms where id=$1", [req.params.id]);
  return r || (res.sendStatus(404), null);
};
app.post("/api/admin/rooms/:id/archive", auth("cmd"), su, h(async (req, res) => {
  const r = await room(req, res);
  if (!r) return;
  const on = !!req.body.on;
  await qsys("update rooms set archived=$2,status=case when $2 then 'inactive' else status end where id=$1", [r.id, on]);
  aud("CMD", (on ? "Archived" : "Restored") + " Situation Room " + r.id + " (" + r.name + ", " + r.tenant + ")");
  res.json({ ok: 1 });
}));
// permanently delete a Situation Room AND all its observers (a copy goes to the vault)
app.post("/api/admin/rooms/:id/delete", auth("cmd"), su, h(async (req, res) => {
  const r = await room(req, res);
  if (!r) return;
  if (req.body.confirm !== r.id) return res.status(400).json({ error: "Type the room ID (" + r.id + ") to confirm" });
  const snap = await tx(async (c) => {
    const s = await snapshot(c, "room_" + r.id + "_" + r.name, null, [r.id]);
    await wipe(c, [r.id], false);
    return s;
  });
  keepMedia(snap);
  aud("CMD", "Deleted Situation Room " + r.id + " (" + r.name + ", " + r.tenant + ") with all its observers; copy kept: " + snap.name);
  res.json({ ok: 1, kept: snap.name });
}));
app.post("/api/admin/rooms/:id/wipe", auth("cmd"), su, h(async (req, res) => {
  const r = await room(req, res);
  if (!r) return;
  if (req.body.confirm !== r.id) return res.status(400).json({ error: "Type the room ID (" + r.id + ") to confirm" });
  const snap = await tx(async (c) => {
    const s = await snapshot(c, "cleared-room_" + r.id, null, [r.id]);
    await wipe(c, [r.id], true);
    return s;
  });
  keepMedia(snap);
  aud("CMD", "Cleared all election data of Situation Room " + r.id + " (" + r.tenant + "); copy kept: " + snap.name);
  res.json({ ok: 1, kept: snap.name });
}));
// ---- the vault: copies kept of everything deleted or cleared ----
app.get("/api/admin/vault", auth("cmd"), su, h(async (req, res) =>
  res.json(
    fs.readdirSync(VAULT).filter((n) => /\.json$/.test(n)).map((n) => {
      const s = fs.statSync(path.join(VAULT, n));
      return { name: n, size: s.size, ts: s.mtime, media: fs.existsSync(path.join(VAULT, n.replace(/\.json$/, "") + "_media")) };
    }).sort((a, b) => (a.name < b.name ? 1 : -1)),
  ),
));
app.get("/api/admin/vault/:name", auth("cmd"), su, h(async (req, res) => {
  const n = String(req.params.name);
  if (!/^[A-Za-z0-9_.-]+\.json$/.test(n) || !fs.existsSync(path.join(VAULT, n))) return res.sendStatus(404);
  res.download(path.join(VAULT, n), n);
}));

// ---- review archived data: archived Command Centers / rooms (still in the database) and vault copies of deleted ones ----
const slimUnits = (l) => l.slice(0, 3000).map((x) => ({ lga: x.lga, ward: x.ward, pu: x.pu, pu_name: x.pu_name, contest: x.contest, status: x.status, total: x.total, fig: x.fig, verified: x.verified, ec8a: x.ec8a, room_id: x.room_id }));
function summary(title, units, observers, rooms, extra) {
  const totals = {},
    counts = { units: units.length, reporting: units.filter((x) => x.status != "pending").length, verified: units.filter((x) => x.verified).length, disputed: units.filter((x) => x.status == "disputed").length, observers: observers.length, rooms: rooms.length, ec8a: units.reduce((s, x) => s + (x.ec8a || 0), 0) };
  units.forEach((x) => x.fig && Object.entries(x.fig).forEach(([p, v]) => (totals[p] = (totals[p] || 0) + v)));
  return { title, totals, total: Object.values(totals).reduce((a, b) => a + b, 0), counts, units: slimUnits(units), observers: observers.slice(0, 3000), rooms, truncated: units.length > 3000 || observers.length > 3000, ...extra };
}
const obsRows = async (rooms) => {
  const o = await qsys("select code,name,room_id,state,lga,ward,pu,active from observers where room_id=any($1) order by room_id,code limit 3001", [rooms]),
    t = await qsys("select code,party,v from tallies where code=any($1)", [o.map((x) => x.code)]),
    m = {};
  t.forEach((x) => ((m[x.code] = m[x.code] || {})[x.party] = x.v));
  return o.map((x) => ({ ...x, t: m[x.code] || {} }));
};
app.get("/api/admin/archive", auth("cmd"), su, h(async (req, res) => {
  res.json({
    centers: await qsys("select t.id,t.name,t.state,(select count(*)::int from rooms where tenant=t.id) rooms,(select count(*)::int from observers o join rooms r on r.id=o.room_id where r.tenant=t.id) observers from tenants t where coalesce(t.archived,false) order by t.id"),
    rooms: await qsys("select r.id,r.name,r.state,r.scope,r.kind,r.tenant,t.name tenant_name,(select count(*)::int from observers where room_id=r.id) obs from rooms r join tenants t on t.id=r.tenant where coalesce(r.archived,false) order by r.tenant,r.id"),
    vault: fs.readdirSync(VAULT).filter((n) => /\.json$/.test(n)).map((n) => {
      const s = fs.statSync(path.join(VAULT, n));
      return { name: n, size: s.size, ts: s.mtime, media: fs.existsSync(path.join(VAULT, n.replace(/\.json$/, "") + "_media")) };
    }).sort((a, b) => (a.name < b.name ? 1 : -1)),
  });
}));
app.get("/api/admin/review", auth("cmd"), su, h(async (req, res) => {
  let tn, rooms, f = { withArchived: true }, title;
  if (req.query.room) {
    const [r] = await qsys("select r.id,r.name,r.tenant,r.state,r.scope,r.kind,r.status,coalesce(r.archived,false) archived from rooms r where id=$1", [String(req.query.room)]);
    if (!r) return res.sendStatus(404);
    (tn = r.tenant), (rooms = [r]), (f.room = r.id), (title = "Situation Room " + r.name + " (" + r.id + ")");
  } else {
    const [t] = await qsys("select id,name from tenants where id=$1", [String(req.query.tenant || "")]);
    if (!t) return res.sendStatus(404);
    (tn = t.id), (title = "Command Center " + t.name + " (" + t.id + ")");
    rooms = await qsys("select id,name,state,scope,kind,status,coalesce(archived,false) archived from rooms where tenant=$1 order by id", [tn]);
  }
  const units = await als.run({ name: "review", tn, room: "" }, () => puList({ role: "cmd", tn, id: "review" }, f));
  res.json(summary(title, units, await obsRows(rooms.map((r) => r.id)), rooms, { source: "live" }));
}));
// the same review from a vault copy (the live rows are gone): figures are reconciled exactly as the live collation does
app.get("/api/admin/vault/:name/review", auth("cmd"), su, h(async (req, res) => {
  const n = String(req.params.name);
  if (!/^[A-Za-z0-9_.-]+\.json$/.test(n) || !fs.existsSync(path.join(VAULT, n))) return res.sendStatus(404);
  const snap = JSON.parse(fs.readFileSync(path.join(VAULT, n), "utf8")),
    kind = Object.fromEntries(snap.rooms.map((r) => [r.id, r.kind || "general"])),
    key = (o) => [o.state, o.lga, o.ward, o.pu, kind[o.room_id] || "general"].join("|"),
    T = {};
  snap.tallies.forEach((t) => ((T[t.code] = T[t.code] || {})[t.party] = t.v));
  const R = Object.fromEntries(snap.pu_results.map((r) => [key(r), r])),
    P = {},
    G = {};
  snap.ec8a.forEach((e) => (P[key(e)] = (P[key(e)] || 0) + 1));
  snap.observers.forEach((o) => (G[key(o)] = G[key(o)] || []).push(o));
  const units = Object.entries(G).map(([k, l]) => {
    const subs = l.filter((o) => T[o.code] && Object.keys(T[o.code]).length),
      rs = R[k];
    let status, fig = null;
    if (rs) (status = "resolved"), (fig = rs.final);
    else if (!subs.length) status = "pending";
    else if (subs.length == 1) (status = "single"), (fig = T[subs[0].code]);
    else {
      const ps = [...new Set(subs.flatMap((o) => Object.keys(T[o.code])))],
        conflict = ps.some((p) => new Set(subs.filter((o) => p in T[o.code]).map((o) => T[o.code][p])).size > 1),
        full = ps.every((p) => subs.every((o) => p in T[o.code]));
      status = conflict ? "disputed" : full ? "matched" : "partial";
      if (!conflict) fig = Object.assign({}, ...subs.map((o) => T[o.code]));
    }
    const o0 = l[0],
      photos = P[k] || 0;
    return { lga: o0.lga, ward: o0.ward, pu: o0.pu, pu_name: o0.pu_name, contest: kind[o0.room_id], status, fig, total: fig ? Object.values(fig).reduce((a, b) => a + b, 0) : 0, verified: (status == "matched" || status == "resolved") && photos > 0, ec8a: photos, room_id: o0.room_id };
  });
  res.json(summary("Stored copy " + n.replace(/\.json$/, ""), units, snap.observers.map((o) => ({ ...o, t: T[o.code] || {} })), snap.rooms, { source: "vault", taken_at: snap.taken_at, file: n }));
}));
