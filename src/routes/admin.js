const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
const { execFile } = require("child_process");
const push = (pred, m) => require("../ws").push(pred, m);
app.get("/api/health", h(async (req, res) => {
  await qsys("select 1");
  res.json({ ok: 1, time: new Date(), uptime: Math.round(process.uptime()) });
}));
// ---- observer device reset (lost / replaced phone) ----
app.post(
  "/api/obs/:code/reset-device",
  auth("cmd", "room"),
  h(async (req, res) => {
    const o = await own(req.u, req.params.code);
    if (!o) return res.sendStatus(404);
    await q("update observers set device_hash=null,pin_hash=null where code=$1", [o.code]);
    push((c) => c.u.role == "obs" && c.u.id == o.code, { type: "reset" });
    aud(req.u.id, "Reset device lock for " + o.code);
    res.json({ ok: 1 });
  }),
);
// ---- on-demand live video: the room asks, the observer phone starts / stops its camera ----
app.post(
  "/api/obs/:code/live",
  auth("cmd", "room"),
  h(async (req, res) => {
    const o = await own(req.u, req.params.code),
      on = !!req.body.on;
    if (!o) return res.sendStatus(404);
    await q("update observers set live_req=$2 where code=$1", [o.code, on]);
    const n = push((c) => c.u.role == "obs" && c.u.id == o.code, { type: "live", on, by: req.u.id });
    aud(req.u.id, (on ? "Requested" : "Ended") + " live video from " + o.code);
    res.json({ ok: 1, delivered: n > 0 });
  }),
);
// ---- bulk contacts (CSV / TXT / Excel parsed in the browser into rows) ----
const LEVELS = ["State", "LGA", "Ward", "PU"],
  ROLES = ["Emergency", "Security", "Supervisor"];
app.post(
  "/api/contacts/bulk",
  express.json({ limit: "10mb" }),
  auth("cmd", "room"),
  h(async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 20000) : [];
    if (!rows.length) return res.status(400).json({ error: "No rows" });
    const fix = (v, l) => l.find((x) => x.toLowerCase() == String(v || "").trim().toLowerCase());
    const ok = [],
      errors = [];
    let rstate = null;
    if (req.u.role == "room") rstate = (await q("select state from rooms where id=$1", [req.u.id]))[0]?.state;
    rows.forEach((r, i) => {
      const name = String(r.name || "").trim().slice(0, 80),
        phone = String(r.phone || "").replace(/[^\d+]/g, "").slice(0, 20),
        state = fix(r.state, STATES) || rstate;
      if (!name || phone.length < 7 || !state) return errors.push({ row: i + 2, error: !name ? "name missing" : phone.length < 7 ? "bad phone" : "unknown state" });
      const loc = String(r.loc || [r.lga, r.ward, r.pu && "PU " + r.pu].filter(Boolean).join(" · ")).slice(0, 160);
      ok.push([req.u.role == "room" ? req.u.id : null, name, phone, fix(r.role, ROLES) || "Emergency", fix(r.level, LEVELS) || (r.pu ? "PU" : r.ward ? "Ward" : r.lga ? "LGA" : "State"), state, loc, req.u.tn]);
    });
    for (let i = 0; i < ok.length; i += 1000) {
      const x = ok.slice(i, i + 1000);
      await q(
        "insert into contacts(room_id,name,phone,role,level,state,loc,tenant) select * from unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[],$8::text[])",
        [0, 1, 2, 3, 4, 5, 6, 7].map((k) => x.map((r) => r[k])),
      );
    }
    aud(req.u.id, "Bulk-imported " + ok.length + " contacts (" + errors.length + " rejected)");
    res.json({ added: ok.length, rejected: errors.length, errors: errors.slice(0, 50) });
  }),
);
// ---- automatic database backups on this PC (pg_dump custom format) ----
const BK = path.join(DATA, "backups"),
  BMIN = +(E.BACKUP_MINS ?? 30),
  KEEP = +E.BACKUP_KEEP || 96;
function backup() {
  return new Promise((ok, no) => {
    fs.mkdirSync(BK, { recursive: true });
    const f = path.join(BK, "collation_" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".dump");
    execFile("pg_dump", ["-Fc", "-f", f, "--dbname=" + (E.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/collation")], { timeout: 600000 }, (e) => {
      if (e) return no(new Error("pg_dump failed: " + e.message));
      const l = fs.readdirSync(BK).filter((x) => x.endsWith(".dump")).sort();
      l.slice(0, Math.max(0, l.length - KEEP)).forEach((x) => fs.unlinkSync(path.join(BK, x)));
      ok(path.basename(f));
    });
  });
}
if (BMIN > 0)
  setInterval(() => backup().then((f) => console.log("backup", f)).catch((e) => console.log(e.message)), BMIN * 60000).unref();
app.get(
  "/api/backups",
  auth("cmd"),
  su,
  h(async (req, res) => {
    fs.mkdirSync(BK, { recursive: true });
    res.json({
      every: BMIN,
      keep: KEEP,
      dir: BK,
      files: fs.readdirSync(BK).filter((x) => x.endsWith(".dump")).sort().reverse().map((x) => ({ name: x, size: fs.statSync(path.join(BK, x)).size })),
    });
  }),
);
app.post(
  "/api/backups",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const f = await backup();
    aud("CMD", "Manual backup " + f);
    res.json({ name: f });
  }),
);
app.get(
  "/api/backups/:name",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const n = path.basename(req.params.name);
    if (!/^collation_[\w-]+\.dump$/.test(n) || !fs.existsSync(path.join(BK, n))) return res.sendStatus(404);
    aud("CMD", "Downloaded backup " + n);
    res.download(path.join(BK, n));
  }),
);
