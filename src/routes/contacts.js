const {LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- contacts ----
app.get(
  "/api/contacts",
  auth(),
  h(async (req, res) => {
    const u = req.u;
    if (u.role == "obs") return res.json([]);
    if (u.role == "cmd")
      return res.json(await q("select * from contacts where tenant=$1 order by id desc", [u.tn]));
    const [r] = await q("select state from rooms where id=$1", [u.id]);
    res.json(
      await q(
        "select * from contacts where room_id=$1 or (room_id is null and tenant=$3 and (state is null or state=$2)) order by id desc",
        [u.id, r.state, u.tn],
      ),
    );
  }),
);
app.post(
  "/api/contacts",
  auth("cmd", "room"),
  h(async (req, res) => {
    const b = req.body;
    if (!b.name || !b.phone) return res.status(400).json({ error: "Name and phone required" });
    await q(
      "insert into contacts(room_id,name,phone,role,level,state,loc,tenant) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        req.u.role == "room" ? req.u.id : null,
        b.name,
        b.phone,
        b.role,
        b.level,
        b.state,
        b.loc || "",
        req.u.tn,
      ],
    );
    aud(req.u.id, "Added contact " + b.name);
    res.json({ ok: 1 });
  }),
);
app.delete(
  "/api/contacts/:id",
  auth("cmd", "room"),
  h(async (req, res) => {
    await q("delete from contacts where id=$1 and tenant=$3 and ($2::text is null or room_id=$2)", [
      req.params.id,
      req.u.role == "room" ? req.u.id : null,
      req.u.tn,
    ]);
    res.json({ ok: 1 });
  }),
);
app.get(
  "/api/audit",
  auth("cmd"),
  h(async (req, res) =>
    res.json(await q("select * from audit where tenant=$1 order by id desc limit 500", [req.u.tn])),
  ),
);
