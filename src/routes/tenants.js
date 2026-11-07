const {LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- Command Centers (tenants): platform administrator only ----
app.get(
  "/api/tenants",
  auth("cmd"),
  su,
  h(async (req, res) =>
    res.json(
      await q(
        "select t.id,t.name,t.active,(select count(*)::int from rooms where tenant=t.id) rooms,(select count(*)::int from cmd_users where tenant=t.id) operators from tenants t order by t.id",
      ),
    ),
  ),
);
app.post(
  "/api/tenants",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const { name, operator, pass } = req.body;
    if (!String(name || "").trim()) return res.status(400).json({ error: "Name required" });
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(operator || ""))
      return res.status(400).json({ error: "Operator name: 2-40 letters, digits . _ -" });
    if (String(pass || "").length < 8)
      return res.status(400).json({ error: "Passcode must be at least 8 characters" });
    const id = "CC-" + rnd(4);
    try {
      await q("insert into tenants(id,name) values($1,$2)", [id, String(name).trim().slice(0, 80)]);
      await q("insert into cmd_users(name,pass_hash,tenant) values($1,$2,$3)", [
        operator,
        await bcrypt.hash(String(pass), 10),
        id,
      ]);
    } catch {
      await q("delete from tenants where id=$1", [id]);
      return res.status(409).json({ error: "That operator name already exists" });
    }
    aud("CMD", "Created Command Center " + id + " (" + name + ")");
    res.json({ id });
  }),
);
app.post(
  "/api/tenants/:id/toggle",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const [t] = await q("select * from tenants where id=$1", [req.params.id]);
    if (!t) return res.sendStatus(404);
    if (t.id == req.u.tn)
      return res.status(400).json({ error: "You cannot disable your own Command Center" });
    await q("update tenants set active=not active where id=$1", [t.id]);
    if (t.active) await q("update rooms set status='suspended' where tenant=$1 and status='active'", [t.id]);
    aud("CMD", (t.active ? "Disabled " : "Enabled ") + "Command Center " + t.id);
    res.json({ ok: 1 });
  }),
);
