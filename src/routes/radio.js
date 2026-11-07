const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- radio gateway (SDR decoder -> Situation Room) ----
app.post(
  "/api/radio/key",
  auth("room"),
  h(async (req, res) => {
    const k = "GW." + req.u.id + "." + rnd(32);
    await q("insert into radio_keys values($1,$2) on conflict(room_id) do update set key_hash=$2", [
      req.u.id,
      await bcrypt.hash(k, 8),
    ]);
    aud(req.u.id, "Generated radio gateway key");
    res.json({ key: k });
  }),
);
const gw = async (req, res, next) => {
  try {
    const k = String(req.headers["x-gateway-key"] || ""),
      m = k.match(/^GW\.([^.]+)\.[A-Z0-9]+$/);
    if (!m) return res.status(401).json({ error: "Bad gateway key" });
    const [r] = await q(
      "select k.key_hash,r.status from radio_keys k join rooms r on r.id=k.room_id where k.room_id=$1",
      [m[1]],
    );
    if (!r || !(await bcrypt.compare(k, r.key_hash)))
      return res.status(401).json({ error: "Bad gateway key" });
    if (r.status != "active") return res.status(403).json({ error: "Room not active" });
    req.room = m[1];
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
app.post(
  "/api/radio/ingest",
  rate,
  gw,
  h(async (req, res) => {
    const b = req.body,
      f = clean(b.freq),
      tg = clean(b.talkgroup),
      u = clean(b.unit);
    await q("insert into radio(room_id,text,alert,freq,talkgroup,unit) values($1,$2,$3,$4,$5,$6)", [
      req.room,
      String(b.text || "Call" + (u ? " from " + u : "")).slice(0, 300),
      !!b.alert,
      f,
      tg,
      u,
    ]);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/radio/audio",
  gw,
  express.raw({ type: "*/*", limit: "60mb" }),
  h(async (req, res) => {
    if (!req.body?.length) return res.status(400).json({ error: "Empty audio" });
    const d = path.join(DATA, "radio", req.room);
    fs.mkdirSync(d, { recursive: true });
    const ext = /mp3|mpeg/.test(req.headers["content-type"] || "")
        ? "mp3"
        : /ogg/.test(req.headers["content-type"] || "")
          ? "ogg"
          : "wav",
      f = path.join(d, Date.now() + "_" + rnd(4) + "." + ext),
      q_ = req.query;
    fs.writeFileSync(f, req.body);
    const fr = clean(q_.freq),
      tg = clean(q_.tg),
      u = clean(q_.unit);
    await q("insert into radio(room_id,text,freq,talkgroup,unit,audio_path) values($1,$2,$3,$4,$5,$6)", [
      req.room,
      "Call" + (u ? " from " + u : "") + (q_.dur ? " (" + clean(q_.dur) + "s)" : ""),
      fr,
      tg,
      u,
      f,
    ]);
    res.json({ ok: 1 });
  }),
);
app.get(
  "/api/radio/:id/audio",
  auth("cmd", "room"),
  h(async (req, res) => {
    const [x] = await q("select * from radio where id=$1 and audio_path is not null", [req.params.id]);
    if (
      !x ||
      (req.u.role == "room" && x.room_id != req.u.id) ||
      (req.u.role == "cmd" && !(await mine(req.u, x.room_id)))
    )
      return res.sendStatus(404);
    res.sendFile(x.audio_path);
  }),
);
app.post(
  "/api/observer/spectrum",
  auth("obs"),
  h(async (req, res) => {
    const hits = (Array.isArray(req.body.hits) ? req.body.hits : [])
      .slice(0, 10)
      .filter((x) => isFinite(+x.freq));
    if (!hits.length) return res.status(400).json({ error: "No hits" });
    const [o] = await q("select * from observers where code=$1", [req.u.id]);
    await q("insert into radio(room_id,text,alert,freq,code) values($1,$2,false,$3,$4)", [
      o.room_id,
      "Observer " +
        o.code +
        " (PU " +
        o.pu +
        ") detected: " +
        hits
          .map(
            (x) =>
              (+x.freq).toFixed(4) + " MHz" + (x.power != null ? " (" + Math.round(x.power) + " dB)" : ""),
          )
          .join(", "),
      clean(hits[0].freq),
      o.code,
    ]);
    res.json({ ok: 1 });
  }),
);
