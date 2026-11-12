const {qsys,fs,path,DATA,pool,aud,h,app,auth,su} = require("../core");
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
