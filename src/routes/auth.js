const {LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
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
    aud("CMD:" + c.name, "Command Center login", c.tenant);
    res.json({ token: jwt.sign({ role: "cmd", id: "CMD", name: c.name }, SECRET, { expiresIn: "12h" }) });
  }),
);
app.get(
  "/api/cmdusers",
  auth("cmd"),
  h(async (req, res) =>
    res.json(await q("select id,name,active from cmd_users where tenant=$1 order by id", [req.u.tn])),
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
    const r = await pool.query("update cmd_users set pass_hash=$2 where id=$1 and tenant=$3", [
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
    aud(o.code, "Observer login");
    res.json({ token: jwt.sign({ role: "obs", id: o.code, room: o.room_id }, SECRET, { expiresIn: "24h" }) });
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
        tenant: (await q("select name from tenants where id=$1", [u.tn]))[0]?.name,
      });
    if (u.role == "room") {
      const [r] = await q("select id,name,state,scope,operator,status,activated_at from rooms where id=$1", [
        u.id,
      ]);
      return res.json({ role: "room", id: u.id, room: r });
    }
    const [o] = await q(
      "select o.*,r.name room_name from observers o join rooms r on r.id=o.room_id where code=$1",
      [u.id],
    );
    res.json({ role: "obs", id: u.id, obs: o });
  }),
);
