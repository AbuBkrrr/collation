const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
const TOTP = require("../totp");
// an APK is available if it was dropped in DATA_DIR or committed to the repo's apks/ folder by CI
const hasApk = (name) =>
  fs.existsSync(path.join(DATA, name + ".apk")) || fs.existsSync(path.join(__dirname, "..", "..", "apks", name + ".apk"));
app.get(
  "/api/config",
  h(async (req, res) => {
    const [c] = await q("select count(*)::int n from locations");
    let ice = [{ urls: "stun:stun.l.google.com:19302" }];
    try {
      ice = JSON.parse(E.ICE_SERVERS);
    } catch {}
    if (E.TURN_SECRET && E.TURN_HOST) {
      let tk = null;
      try {
        tk = jwt.verify((req.headers.authorization || "").slice(7), SECRET);
      } catch {}
      if (tk) {
        const us = Math.floor(Date.now() / 1000) + 86400 + ":" + tk.id;
        ice = [
          { urls: "stun:" + E.TURN_HOST + ":3478" },
          {
            urls: [
              "turn:" + E.TURN_HOST + ":3478?transport=udp",
              "turn:" + E.TURN_HOST + ":3478?transport=tcp",
            ],
            username: us,
            credential: crypto.createHmac("sha1", E.TURN_SECRET).update(us).digest("base64"),
          },
        ];
      }
    }
    res.json({
      parties: PARTIES,
      states: STATES,
      ice,
      stt: !!E.STT_URL,
      loc: c.n > 0,
      appName: await appName(await cfgTenant(req)),
      lk: !!(LK && E.LIVEKIT_URL && E.LIVEKIT_API_KEY),
      apk: hasApk("observer"),
      apkRoom: hasApk("room"),
    });
  }),
);
app.post(
  "/api/login/command",
  rate,
  h(async (req, res) => {
    const nm = String(req.body.user || req.body.id || "admin").trim(),
      [c] = await q(
        "select c.*,t.active ta from cmd_users c join tenants t on t.id=c.tenant where lower(c.name)=lower($1) and c.active",
        [nm],
      );
    if (!c || !c.ta || !(await bcrypt.compare(String(req.body.pass || ""), c.pass_hash)))
      return res.status(401).json({ error: "Wrong operator name or passcode, or Command Center disabled" });
    if (c.totp && !TOTP.verify(c.totp, req.body.otp))
      return res.status(401).json({ error: "Enter the 6-digit code from your authenticator app", otp: true });
    aud("CMD:" + c.name, "Command Center login", c.tenant);
    res.json({ token: jwt.sign({ role: "cmd", id: "CMD", name: c.name }, SECRET, { expiresIn: "12h" }) });
  }),
);
app.get(
  "/api/cmdusers",
  auth("cmd"),
  h(async (req, res) =>
    res.json(await q("select id,name,active,totp is not null totp from cmd_users where tenant=$1 order by id", [req.u.tn])),
  ),
);
app.post(
  "/api/cmdusers",
  auth("cmd"),
  h(async (req, res) => {
    const n = String(req.body.name || "")
        .trim()
        .slice(0, 40),
      p = String(req.body.pass || "");
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(n))
      return res.status(400).json({ error: "Name: 2-40 letters, digits . _ -" });
    if (p.length < 8) return res.status(400).json({ error: "Passcode must be at least 8 characters" });
    try {
      await q("insert into cmd_users(name,pass_hash,tenant) values($1,$2,$3)", [
        n,
        await bcrypt.hash(p, 10),
        req.u.tn,
      ]);
    } catch {
      return res.status(409).json({ error: "That operator name exists" });
    }
    aud("CMD", "Added Command operator " + n);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/cmdusers/:id/toggle",
  auth("cmd"),
  h(async (req, res) => {
    const [c] = await q("select * from cmd_users where id=$1 and tenant=$2", [req.params.id, req.u.tn]);
    if (!c) return res.sendStatus(404);
    if (c.name.toLowerCase() == String(req.u.name).toLowerCase())
      return res.status(400).json({ error: "You cannot disable your own account" });
    await q("update cmd_users set active=not active where id=$1", [c.id]);
    aud("CMD", (c.active ? "Disabled " : "Enabled ") + "operator " + c.name);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/cmdusers/:id/reset",
  auth("cmd"),
  h(async (req, res) => {
    const p = String(req.body.pass || "");
    if (p.length < 8) return res.status(400).json({ error: "Passcode must be at least 8 characters" });
    const r = await qx("update cmd_users set pass_hash=$2 where id=$1 and tenant=$3", [
      req.params.id,
      await bcrypt.hash(p, 10),
      req.u.tn,
    ]);
    if (!r.rowCount) return res.sendStatus(404);
    aud("CMD", "Reset operator passcode id " + req.params.id);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/login/room",
  rate,
  h(async (req, res) => {
    const [r] = await q("select * from rooms where upper(id)=upper($1)", [req.body.id || ""]);
    if (!r || !(await bcrypt.compare(String(req.body.pass || ""), r.pass_hash)))
      return res.status(401).json({ error: "Invalid room ID or passcode" });
    if (r.status != "active")
      return res.status(403).json({ error: "This room has not been activated by Command Center" });
    aud(r.id, "Room login");
    res.json({ token: jwt.sign({ role: "room", id: r.id }, SECRET, { expiresIn: "12h" }) });
  }),
);
app.post(
  "/api/login/observer",
  rate,
  h(async (req, res) => {
    const [o] = await q(
      "select o.*,r.status rs from observers o join rooms r on r.id=o.room_id where code=$1",
      [
        String(req.body.code || "")
          .trim()
          .toUpperCase(),
      ],
    );
    if (!o || !o.active) return res.status(401).json({ error: "Invalid or revoked code" });
    if (o.rs != "active") return res.status(403).json({ error: "Your Situation Room is not active" });
    // Device lock: the first phone that logs in with a code owns it (with a PIN the observer chooses).
    // Only the observer's room or Command Center can reset it to a new phone.
    const dev = String(req.body.device || ""),
      pin = String(req.body.pin || "");
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(dev)) return res.status(400).json({ error: "Missing device id" });
    if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: "PIN must be 4-8 digits" });
    const dh = crypto.createHash("sha256").update(dev).digest("hex");
    if (!o.device_hash) {
      const r = await qsys(
        "update observers set device_hash=$2,pin_hash=$3 where code=$1 and device_hash is null returning code",
        [o.code, dh, await bcrypt.hash(pin, 10)],
      );
      if (!r.length) return res.status(409).json({ error: "This code was just claimed by another phone" });
      aud(o.code, "Observer first login - device locked");
    } else {
      if (o.device_hash != dh)
        return res
          .status(403)
          .json({ error: "This code is locked to another phone. Ask your Situation Room to reset the device." });
      if (!(await bcrypt.compare(pin, o.pin_hash || ""))) return res.status(401).json({ error: "Wrong PIN" });
      aud(o.code, "Observer login");
    }
    res.json({
      token: jwt.sign({ role: "obs", id: o.code, room: o.room_id, dh: dh.slice(0, 16) }, SECRET, { expiresIn: "24h" }),
    });
  }),
);
app.get(
  "/api/me",
  auth(),
  h(async (req, res) => {
    const u = req.u;
    if (u.role == "cmd")
      return res.json({
        role: "cmd",
        id: "CMD",
        name: u.name,
        su: u.su,
        tenant: (await qsys("select name from tenants where id=$1", [u.tn]))[0]?.name,
        tenantState: (await qsys("select state from tenants where id=$1", [u.tn]))[0]?.state,
      });
    if (u.role == "room") {
      const [r] = await q("select id,name,state,scope,operator,status,activated_at from rooms where id=$1", [
        u.id,
      ]);
      const [t] = await qsys("select name,state from tenants where id=$1", [u.tn]);
      return res.json({ role: "room", id: u.id, room: r, cc: t?.name, ccState: t?.state });
    }
    const [o] = await q(
      "select o.*,r.name room_name from observers o join rooms r on r.id=o.room_id where code=$1",
      [u.id],
    );
    delete o.device_hash;
    delete o.pin_hash;
    const [t] = await qsys("select name from tenants where id=$1", [u.tn]);
    res.json({ role: "obs", id: u.id, obs: o, cc: t?.name });
  }),
);
// ---- two-step login (TOTP) for Command operators ----
app.get(
  "/api/totp",
  auth("cmd"),
  h(async (req, res) => {
    const [c] = await q("select (totp is not null) enabled from cmd_users where lower(name)=lower($1)", [req.u.name]);
    res.json({ on: !!c?.enabled });
  }),
);
app.post(
  "/api/totp/setup",
  auth("cmd"),
  h(async (req, res) => {
    const sec = TOTP.secret();
    await q("update cmd_users set totp_pending=$2 where lower(name)=lower($1)", [req.u.name, sec]);
    res.json({ secret: sec, uri: TOTP.uri(sec, req.u.name, await appName(req.u.tn)) });
  }),
);
app.post(
  "/api/totp/enable",
  auth("cmd"),
  h(async (req, res) => {
    const [c] = await q("select totp_pending from cmd_users where lower(name)=lower($1)", [req.u.name]);
    if (!TOTP.verify(c?.totp_pending, req.body.code))
      return res.status(400).json({ error: "Code does not match - check the phone clock and try again" });
    await q("update cmd_users set totp=totp_pending,totp_pending=null where lower(name)=lower($1)", [req.u.name]);
    aud("CMD", "Enabled two-step login");
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/totp/disable",
  auth("cmd"),
  h(async (req, res) => {
    const [c] = await q("select totp from cmd_users where lower(name)=lower($1)", [req.u.name]);
    if (!TOTP.verify(c?.totp, req.body.code)) return res.status(400).json({ error: "Wrong code" });
    await q("update cmd_users set totp=null where lower(name)=lower($1)", [req.u.name]);
    aud("CMD", "Disabled two-step login");
    res.json({ ok: 1 });
  }),
);
// a Command operator can clear another operator's two-step login (lost phone)
app.post(
  "/api/cmdusers/:id/totp-reset",
  auth("cmd"),
  h(async (req, res) => {
    const r = await qx("update cmd_users set totp=null,totp_pending=null where id=$1 and tenant=$2", [
      req.params.id,
      req.u.tn,
    ]);
    if (!r.rowCount) return res.sendStatus(404);
    aud("CMD", "Cleared two-step login for operator id " + req.params.id);
    res.json({ ok: 1 });
  }),
);
