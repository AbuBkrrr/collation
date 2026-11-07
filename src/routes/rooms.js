const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- rooms (Command) ----
app.get(
  "/api/rooms",
  auth("cmd"),
  h(async (req, res) =>
    res.json(
      await q(
        `select r.id,r.name,r.state,r.scope,r.operator,r.status,r.activated_at,(r.last_seen>now()-interval '40 seconds') online,(select count(*)::int from observers where room_id=r.id) obs,(select coalesce(sum(pend),0)::int from observers where room_id=r.id) pend from rooms r where r.tenant=$1 order by r.id`,
        [req.u.tn],
      ),
    ),
  ),
);
app.post(
  "/api/rooms",
  auth("cmd"),
  h(async (req, res) => {
    const b = req.body;
    if (!b.state) { const [t] = await q("select state from tenants where id=$1", [req.u.tn]); if (t?.state) b.state = t.state; }
    if (!b.name || !STATES.includes(b.state))
      return res.status(400).json({ error: "Name and valid state required" });
    const id = "SR-" + abbr(b.state) + "-" + rnd(3),
      pass = rnd(10);
    await q("insert into rooms(id,name,state,scope,operator,pass_hash,tenant) values($1,$2,$3,$4,$5,$6,$7)", [
      id,
      b.name,
      b.state,
      b.scope || "",
      b.operator || "",
      await bcrypt.hash(pass, 10),
      req.u.tn,
    ]);
    aud("CMD", "Created room " + id);
    res.json({ id, passcode: pass });
  }),
);
app.patch(
  "/api/rooms/:id",
  auth("cmd"),
  h(async (req, res) => {
    if (!(await mine(req.u, req.params.id))) return res.sendStatus(404);
    const b = req.body;
    await q(
      "update rooms set name=coalesce($5,name),state=coalesce($2,state),scope=coalesce($3,scope),operator=coalesce($4,operator) where id=$1",
      [req.params.id, b.state, b.scope, b.operator, b.name ? String(b.name).slice(0, 80) : null],
    );
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/rooms/:id/status",
  auth("cmd"),
  h(async (req, res) => {
    const s = req.body.status;
    if (!["active", "inactive", "suspended"].includes(s)) return res.sendStatus(400);
    if (!(await mine(req.u, req.params.id))) return res.sendStatus(404);
    await q(
      "update rooms set status=$2,activated_at=case when $2='active' then now() else activated_at end where id=$1",
      [req.params.id, s],
    );
    aud("CMD", s + " room " + req.params.id);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/rooms/:id/reset",
  auth("cmd"),
  h(async (req, res) => {
    if (!(await mine(req.u, req.params.id))) return res.sendStatus(404);
    const p = rnd(10);
    await q("update rooms set pass_hash=$2 where id=$1", [req.params.id, await bcrypt.hash(p, 10)]);
    aud("CMD", "Reset passcode " + req.params.id);
    res.json({ passcode: p });
  }),
);
