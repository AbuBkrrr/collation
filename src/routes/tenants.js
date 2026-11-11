const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- Command Centers (tenants): platform administrator only ----
app.get(
  "/api/tenants",
  auth("cmd"),
  su,
  h(async (req, res) =>
    res.json(
      await qsys(
        "select t.id,t.name,t.state,t.active,t.pool,(select count(*)::int from rooms where tenant=t.id) rooms,(select count(*)::int from cmd_users where tenant=t.id) operators from tenants t order by t.id",
      ),
    ),
  ),
);
app.post(
  "/api/tenants",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const { name } = req.body;
    const state = STATES.includes(req.body.state) ? req.body.state : null;
    if (!String(name || "").trim()) return res.status(400).json({ error: "Name required" });
    // Operator name and passcode are optional: if left blank (or the chosen name is taken),
    // we derive a unique operator from the Command Center name and/or auto-generate a passcode,
    // so creating a center for a client never fails on a name clash. The plaintext passcode is
    // returned once here so it can be shared with the client, then only its hash is stored.
    const provided = String(req.body.operator || "").trim();
    if (provided && !/^[A-Za-z0-9._-]{2,40}$/.test(provided))
      return res.status(400).json({ error: "Operator name: 2-40 letters, digits . _ -" });
    const providedPass = String(req.body.pass || "");
    if (providedPass && providedPass.length < 8)
      return res.status(400).json({ error: "Passcode must be at least 8 characters" });
    // build a unique operator name
    const base =
      (provided || String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "admin");
    let operator = base,
      n = 1;
    // cmd_users.name is globally unique (Command login resolves an operator by name alone),
    // so probe for a free name and suffix -2, -3… if needed.
    while ((await qsys("select 1 from cmd_users where lower(name)=lower($1)", [operator])).length) {
      n++;
      operator = base + "-" + n;
      if (n > 50) return res.status(409).json({ error: "Could not find a free operator name" });
    }
    const pass = providedPass || rnd(10);
    const id = "CC-" + rnd(4);
    try {
      await qsys("insert into tenants(id,name,state) values($1,$2,$3)", [id, String(name).trim().slice(0, 80), state]);
      await qsys("insert into cmd_users(name,pass_hash,tenant) values($1,$2,$3)", [
        operator,
        await bcrypt.hash(String(pass), 10),
        id,
      ]);
    } catch {
      await qsys("delete from tenants where id=$1", [id]);
      return res.status(409).json({ error: "Could not create the Command Center (name clash) — try again" });
    }
    aud("CMD", "Created Command Center " + id + " (" + name + "), operator " + operator);
    res.json({ id, operator, passcode: pass, loginUrl: "/command/" });
  }),
);
// Re-issue a shareable invite for a Command Center: resets its earliest operator's passcode and
// returns the operator name + fresh passcode + login URL so it can be handed to the client.
app.post(
  "/api/tenants/:id/invite",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const [t] = await qsys("select * from tenants where id=$1", [req.params.id]);
    if (!t) return res.sendStatus(404);
    const [op] = await qsys("select * from cmd_users where tenant=$1 order by id asc limit 1", [t.id]);
    if (!op) return res.status(400).json({ error: "This Command Center has no operator yet" });
    const pass = rnd(10);
    await qsys("update cmd_users set pass_hash=$2,active=true where id=$1", [op.id, await bcrypt.hash(pass, 10)]);
    aud("CMD", "Re-issued invite for Command Center " + t.id + " (operator " + op.name + ")");
    res.json({ id: t.id, name: t.name, operator: op.name, passcode: pass, loginUrl: "/command/" });
  }),
);
// whether a Command Center's vote counts are pooled with the other Command Centers of the same state
// (Global Collation only - never maps, video, audio, observers or photos)
app.post(
  "/api/tenants/:id/pool",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const r = await qsys("update tenants set pool=$2 where id=$1 returning id", [req.params.id, !!req.body.on]);
    if (!r.length) return res.sendStatus(404);
    aud("CMD", "Command Center " + req.params.id + " state-wide vote pooling " + (req.body.on ? "ON" : "OFF"));
    res.json({ ok: 1 });
  }),
);
// set (or clear) the state a Command Center is locked to
app.post(
  "/api/tenants/:id/state",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const st = req.body.state ? String(req.body.state) : null;
    if (st && !STATES.includes(st)) return res.status(400).json({ error: "Unknown state" });
    const r = await qsys("update tenants set state=$2 where id=$1 returning id", [req.params.id, st]);
    if (!r.length) return res.sendStatus(404);
    aud("CMD", "Command Center " + req.params.id + " state set to " + (st || "none"));
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/tenants/:id/toggle",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const [t] = await qsys("select * from tenants where id=$1", [req.params.id]);
    if (!t) return res.sendStatus(404);
    if (t.id == req.u.tn)
      return res.status(400).json({ error: "You cannot disable your own Command Center" });
    await qsys("update tenants set active=not active where id=$1", [t.id]);
    if (t.active) await qsys("update rooms set status='suspended' where tenant=$1 and status='active'", [t.id]);
    aud("CMD", (t.active ? "Disabled " : "Enabled ") + "Command Center " + t.id);
    res.json({ ok: 1 });
  }),
);
