const {qsys,fs,path,DATA,pool,aud,h,app,auth,su} = require("../core");
// ---- Platform administrator only: archive (hide, keep, restorable) or permanently delete Command Centers,
// Situation Rooms and their election data. Clients can only suspend / deactivate; they cannot archive or delete. ----
// Runs on the owner connection (qsys / pool), so it can reach every Command Center; every route below requires su.
async function wipe(c, rooms, keepRooms) {
  const files = [];
  const codes = (await c.query("select code from observers where room_id=any($1)", [rooms])).rows.map((x) => x.code);
  (await c.query("select path from clips where room_id=any($1)", [rooms])).rows.forEach((x) => files.push(x.path));
  (await c.query("select audio_path p from radio where room_id=any($1) and audio_path is not null", [rooms])).rows.forEach((x) => files.push(x.p));
  rooms.forEach((r) => files.push(path.join(DATA, "ec8a", r)));
  await c.query("delete from tallies where code=any($1)", [codes]);
  for (const t of ["ec8a", "clips", "incidents", "units", "radio", "pu_results", "observers", "contacts"]) await c.query(`delete from ${t} where room_id=any($1)`, [rooms]);
  if (!keepRooms) {
    for (const t of ["radio_keys", "radio_ctl", "shares"]) await c.query(`delete from ${t} where room_id=any($1)`, [rooms]);
    await c.query("delete from rooms where id=any($1)", [rooms]);
  }
  return files;
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
const rmFiles = (fl) => fl.forEach((f) => { try { fs.rmSync(f, { recursive: true, force: true }); } catch {} });
const who = (u) => "CMD:" + (u.name || "admin");
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
app.post("/api/tenants/:id/delete", auth("cmd"), su, h(async (req, res) => {
  const [t] = await qsys("select * from tenants where id=$1", [req.params.id]);
  if (!t) return res.sendStatus(404);
  if (t.id == req.u.tn) return res.status(400).json({ error: "You cannot delete your own Command Center" });
  if (!t.archived) return res.status(400).json({ error: "Archive it first; only an archived Command Center can be deleted" });
  if (req.body.confirm !== t.id) return res.status(400).json({ error: "Type the Command Center ID (" + t.id + ") to confirm" });
  const files = await tx(async (c) => {
    const rooms = (await c.query("select id from rooms where tenant=$1", [t.id])).rows.map((x) => x.id),
      f = rooms.length ? await wipe(c, rooms, false) : [];
    for (const q of ["shares where tenant", "contacts where tenant", "messages where tenant", "audit where tenant", "cmd_users where tenant"]) await c.query(`delete from ${q}=$1`, [t.id]);
    await c.query("delete from settings where k like $1", ["%:" + t.id]);
    await c.query("delete from tenants where id=$1", [t.id]);
    return f;
  });
  rmFiles(files);
  aud("CMD", "Permanently deleted Command Center " + t.id + " (" + t.name + ") and all its data");
  res.json({ ok: 1 });
}));
// clear a Command Center's election data (observers, results, photos, clips, incidents, radio, messages); keeps the center, its rooms and operators
app.post("/api/tenants/:id/wipe", auth("cmd"), su, h(async (req, res) => {
  const [t] = await qsys("select * from tenants where id=$1", [req.params.id]);
  if (!t) return res.sendStatus(404);
  if (req.body.confirm !== t.id) return res.status(400).json({ error: "Type the Command Center ID (" + t.id + ") to confirm" });
  const files = await tx(async (c) => {
    const rooms = (await c.query("select id from rooms where tenant=$1", [t.id])).rows.map((x) => x.id),
      f = rooms.length ? await wipe(c, rooms, true) : [];
    await c.query("delete from messages where tenant=$1", [t.id]);
    return f;
  });
  rmFiles(files);
  aud("CMD", "Cleared all election data of Command Center " + t.id);
  res.json({ ok: 1 });
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
app.post("/api/admin/rooms/:id/delete", auth("cmd"), su, h(async (req, res) => {
  const r = await room(req, res);
  if (!r) return;
  if (!r.archived) return res.status(400).json({ error: "Archive it first; only an archived room can be deleted" });
  if (req.body.confirm !== r.id) return res.status(400).json({ error: "Type the room ID (" + r.id + ") to confirm" });
  rmFiles(await tx((c) => wipe(c, [r.id], false)));
  aud("CMD", "Permanently deleted Situation Room " + r.id + " (" + r.name + ", " + r.tenant + ") and its data");
  res.json({ ok: 1 });
}));
app.post("/api/admin/rooms/:id/wipe", auth("cmd"), su, h(async (req, res) => {
  const r = await room(req, res);
  if (!r) return;
  if (req.body.confirm !== r.id) return res.status(400).json({ error: "Type the room ID (" + r.id + ") to confirm" });
  rmFiles(await tx((c) => wipe(c, [r.id], true)));
  aud("CMD", "Cleared all election data of Situation Room " + r.id + " (" + r.tenant + ")");
  res.json({ ok: 1 });
}));
