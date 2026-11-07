const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- export & clips ----
app.get(
  "/api/export/:fmt",
  auth("cmd", "room"),
  h(async (req, res) => {
    const u = req.u,
      rid = u.role == "room" ? u.id : req.query.room || null;
    if (rid && u.role == "cmd" && !(await mine(u, rid))) return res.sendStatus(403);
    const rs = rid ? "room_id=$1" : "room_id in (select id from rooms where tenant=$1)",
      pa = [rid || u.tn],
      o = (await q("select * from observers where " + rs + " order by code", pa)).map(
        ({ device_hash, pin_hash, ...x }) => x,
      ),
      t = await q("select * from tallies where code=any($1)", [o.map((x) => x.code)]),
      inc = await q("select * from incidents where " + rs, pa);
    aud(u.id, "Exported " + req.params.fmt);
    if (req.params.fmt == "json") {
      res.attachment("collation.json");
      return res.json({
        exported: new Date(),
        observers: o,
        tallies: t,
        incidents: inc,
        ...(u.role == "cmd"
          ? {
              audit: await q("select * from audit where tenant=$1 order by id desc", [u.tn]),
              rooms: await q("select id,name,state,scope,operator,status from rooms where tenant=$1", [u.tn]),
            }
          : {}),
      });
    }
    const m = {};
    t.forEach((x) => ((m[x.code] = m[x.code] || {})[x.party] = x));
    const c = (x) => '"' + String(x ?? "").replace(/"/g, '""') + '"';
    res
      .attachment("tallies.csv")
      .type("text/csv")
      .send(
        [
          [
            "room",
            "state",
            "lga",
            "ward",
            "pu",
            "code",
            "registered",
            ...PARTIES,
            "total",
            "edited",
            "anomaly",
          ]
            .map(c)
            .join(","),
          ...o.map((x) => {
            const r = m[x.code] || {},
              s = Object.values(r).reduce((a, b) => a + b.v, 0);
            return [
              x.room_id,
              x.state,
              x.lga,
              x.ward,
              x.pu,
              x.code,
              x.reg,
              ...PARTIES.map((p) => r[p]?.v),
              s,
              Object.values(r).filter((z) => z.edits).length,
              s > x.reg ? "YES" : "",
            ]
              .map(c)
              .join(",");
          }),
        ].join("\n"),
      );
  }),
);
app.post(
  "/api/clip",
  express.raw({ type: "*/*", limit: "300mb" }),
  auth("obs"),
  h(async (req, res) => {
    if (!req.body?.length) return res.status(400).json({ error: "Empty" });
    const d = path.join(DATA, "clips", req.u.room);
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, req.u.id + "_" + Date.now() + "_" + rnd(3) + ".webm");
    fs.writeFileSync(f, req.body);
    await q("insert into clips(code,room_id,kind,path) values($1,$2,$3,$4)", [
      req.u.id,
      req.u.room,
      String(req.query.kind || "clip").slice(0, 40),
      f,
    ]);
    res.json({ ok: 1 });
  }),
);
app.get(
  "/api/clips",
  auth("cmd", "room"),
  h(async (req, res) => {
    const u = req.u;
    res.json(
      await q(
        "select id,code,room_id,kind,ts from clips where " +
          (u.role == "room" ? "room_id=$1" : "room_id in (select id from rooms where tenant=$1)") +
          " order by id desc limit 300",
        [u.role == "room" ? u.id : u.tn],
      ),
    );
  }),
);
app.get(
  "/api/clips/:id/file",
  auth("cmd", "room"),
  h(async (req, res) => {
    const [c] = await q("select * from clips where id=$1", [req.params.id]);
    if (
      !c ||
      (req.u.role == "room" && c.room_id != req.u.id) ||
      (req.u.role == "cmd" && !(await mine(req.u, c.room_id)))
    )
      return res.sendStatus(404);
    aud(req.u.id, "Downloaded clip " + c.id);
    res.download(c.path);
  }),
);
app.post(
  "/api/stt",
  express.raw({ type: "*/*", limit: "10mb" }),
  auth("obs"),
  h(async (req, res) => {
    if (!E.STT_URL) return res.status(501).json({ error: "No offline STT service configured (STT_URL)" });
    const r = await fetch(E.STT_URL, {
        method: "POST",
        headers: { "Content-Type": req.headers["content-type"] || "audio/webm" },
        body: req.body,
      }),
      j = await r.json().catch(() => ({}));
    res.json({ text: j.text || j.result || "" });
  }),
);
