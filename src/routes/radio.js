const {qsys,express,bcrypt,fs,path,DATA,q,rnd,aud,h,app,rate,auth,mine,clean,bus} = require("../core");
const multer = require("multer");
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
// gateway key -> room id, or an error code. Keys look like GW.<room id>.<32 random chars>.
async function gwRoom(k) {
  const m = String(k || "").match(/^GW\.([^.]+)\.[A-Z0-9]+$/);
  if (!m) return { err: 401 };
  const [r] = await qsys(
    "select k.key_hash,r.status from radio_keys k join rooms r on r.id=k.room_id where k.room_id=$1",
    [m[1]],
  );
  if (!r || !(await bcrypt.compare(String(k), r.key_hash))) return { err: 401 };
  if (r.status != "active") return { err: 403 };
  return { room: m[1] };
}
const gw = async (req, res, next) => {
  try {
    const g = await gwRoom(req.headers["x-gateway-key"]);
    if (g.err) return res.status(g.err).json({ error: g.err == 401 ? "Bad gateway key" : "Room not active" });
    req.room = g.room;
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
// ---- remote control of the listening post: on/off and tuning, set from the dashboard, applied by the gateway ----
// The dashboard stores the wanted state (power, frequency, mode, squelch); the listening post's tuner.js asks for it
// every few seconds with its gateway key and retunes its SDR. The post also reports what it is actually doing.
const MODES = ["fm", "am", "wbfm"];
const ctlRoom = async (req, res) => {
  const room = req.u.role == "room" ? req.u.id : String((req.method == "GET" ? req.query.room : req.body?.room) || "");
  if (!room) return res.status(400).json({ error: "Choose a room" }), null;
  if (req.u.role == "cmd" && !(await mine(req.u, room))) return res.sendStatus(403), null;
  return room;
};
const ctlShape = (c) => ({
  power: !!c?.power,
  freq: c?.freq ?? null,
  mode: c?.mode || "fm",
  squelch: c?.squelch ?? 40,
  presets: c?.presets || [],
  online: !!c?.gw_seen && Date.now() - new Date(c.gw_seen) < 30000,
  seen: c?.gw_seen || null,
  gw: c?.gw_status || null,
  rev: c?.updated_at ? new Date(c.updated_at).getTime() : 0,
});
app.get(
  "/api/radio/control",
  auth("cmd", "room"),
  h(async (req, res) => {
    const room = await ctlRoom(req, res);
    if (room) res.json(ctlShape((await q("select * from radio_ctl where room_id=$1", [room]))[0]));
  }),
);
app.post(
  "/api/radio/control",
  auth("cmd", "room"),
  h(async (req, res) => {
    const room = await ctlRoom(req, res);
    if (!room) return;
    const b = req.body,
      c = (await q("select * from radio_ctl where room_id=$1", [room]))[0] || {},
      m = { power: !!c.power, freq: c.freq ?? null, mode: c.mode || "fm", squelch: c.squelch ?? 40, presets: c.presets || [] };
    if (b.freq !== undefined && b.freq !== null && b.freq !== "") {
      const f = Math.round(parseFloat(b.freq) * 10000) / 10000;
      // an RTL-SDR tunes about 24-1766 MHz; Nigerian VHF is 138-174 and UHF 403-470
      if (!(f >= 25 && f <= 1700)) return res.status(400).json({ error: "Frequency must be between 25 and 1700 MHz (VHF 138-174, UHF 403-470)" });
      m.freq = f;
    }
    if (b.mode !== undefined) {
      if (!MODES.includes(b.mode)) return res.status(400).json({ error: "Mode must be fm, am or wbfm" });
      m.mode = b.mode;
    }
    if (b.squelch !== undefined) {
      const q_ = parseInt(b.squelch, 10);
      if (!(q_ >= 0 && q_ <= 300)) return res.status(400).json({ error: "Squelch must be 0-300" });
      m.squelch = q_;
    }
    if (Array.isArray(b.presets))
      m.presets = b.presets
        .slice(0, 20)
        .map((p) => ({ name: clean(String(p.name || "").slice(0, 30)) || "Channel", freq: Math.round(parseFloat(p.freq) * 10000) / 10000 }))
        .filter((p) => p.freq >= 25 && p.freq <= 1700);
    if (b.power !== undefined) m.power = !!b.power;
    if (m.power && m.freq == null) return res.status(400).json({ error: "Set a frequency first, then switch the radio on" });
    await q(
      `insert into radio_ctl(room_id,power,freq,mode,squelch,presets,updated_by,updated_at) values($1,$2,$3,$4,$5,$6,$7,now())
       on conflict(room_id) do update set power=$2,freq=$3,mode=$4,squelch=$5,presets=$6,updated_by=$7,updated_at=now()`,
      [room, m.power, m.freq, m.mode, m.squelch, JSON.stringify(m.presets), req.u.role == "cmd" ? "CMD:" + req.u.name : req.u.id],
    );
    if (b.presets === undefined)
      aud(req.u.role == "cmd" ? "CMD" : req.u.id, "Radio " + room + ": " + (m.power ? "ON" : "OFF") + (m.freq ? " " + m.freq.toFixed(4) + " MHz " + m.mode.toUpperCase() + " sq " + m.squelch : ""));
    res.json(ctlShape((await q("select * from radio_ctl where room_id=$1", [room]))[0]));
  }),
);
// the listening post asks what it should be doing (GET so a poll does not wake every dashboard) and reports its state
app.get(
  "/api/radio/gateway/control",
  rate,
  gw,
  h(async (req, res) => {
    const st = { freq: clean(req.query.freq), running: req.query.running == "1", level: clean(req.query.level), error: clean(req.query.error), at: Date.now() };
    await qsys(
      `insert into radio_ctl(room_id,gw_seen,gw_status) values($1,now(),$2)
       on conflict(room_id) do update set gw_seen=now(),gw_status=$2`,
      [req.room, JSON.stringify(st)],
    );
    res.json(ctlShape((await qsys("select * from radio_ctl where room_id=$1", [req.room]))[0]));
  }),
);
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

// ---- trunk-recorder / Rdio Scanner compatible call upload ----
// trunk-recorder's rdioscanner_uploader plugin (the same format OpenMHz and Broadcastify Calls accept)
// POSTs each finished transmission here as multipart/form-data. Point its "server" at https://<domain> and
// its "apiKey" at the room's gateway key. SDRTrunk's Rdio Scanner streaming uses the same fields.
const up = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, fields: 40, files: 1 },
  // only accept audio (or the generic octet-stream some uploaders send); reject anything else outright
  fileFilter: (req, file, cb) =>
    cb(null, /^audio\/|^application\/octet-stream$/.test(file.mimetype || "")),
});
app.post(
  "/api/call-upload",
  up.single("audio"),
  h(async (req, res) => {
    const b = req.body || {},
      g = await gwRoom(b.key);
    if (g.err) return res.status(g.err).type("text").send(g.err == 401 ? "Invalid API key." : "Room not active.");
    if (b.test == "1" || b.test === 1) return res.type("text").send("incomplete call data: no talkgroup");
    if (!req.file?.buffer?.length) return res.status(417).type("text").send("Incomplete call data: no audio");
    const d = path.join(DATA, "radio", g.room);
    fs.mkdirSync(d, { recursive: true });
    const ext = (/\.(m4a|mp3|wav|ogg|aac)$/i.exec(b.audioName || req.file.originalname || "") || [, "m4a"])[1].toLowerCase(),
      f = path.join(d, Date.now() + "_" + rnd(4) + "." + ext);
    fs.writeFileSync(f, req.file.buffer);
    const hz = +b.frequency || 0,
      freq = hz > 1e5 ? (hz / 1e6).toFixed(4) : hz ? String(hz) : null,
      tgl = clean(b.talkgroupLabel || b.talkgroupTag),
      src = clean(b.source);
    await q(
      "insert into radio(room_id,ts,text,freq,talkgroup,unit,audio_path,source,system) values($1,coalesce($2::timestamptz,now()),$3,$4,$5,$6,$7,$8,$9)",
      [
        g.room,
        b.dateTime && !isNaN(+b.dateTime) ? new Date(+b.dateTime * 1000) : null,
        String((tgl ? tgl + " \u00b7 " : "") + "Call" + (src && src != "0" ? " from unit " + src : "") + (freq ? " on " + freq + " MHz" : "")).slice(0, 300),
        freq,
        clean(b.talkgroup),
        src,
        f,
        src,
        clean(b.systemLabel || b.system),
      ],
    );
    bus.notify((await qsys("select tenant from rooms where id=$1", [g.room]))[0]?.tenant);
    res.type("text").send("Call imported successfully.");
  }),
);
