const {LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
app.get(
  "/api/incidents",
  auth(),
  h(async (req, res) => {
    const [w, a] = roomScope(req.u);
    res.json(await q("select * from incidents" + w + " order by id desc limit 300", a));
  }),
);
app.post(
  "/api/incidents/:id/:act",
  auth("room"),
  h(async (req, res) => {
    const [i] = await q("select * from incidents where id=$1 and room_id=$2", [req.params.id, req.u.id]);
    if (!i) return res.sendStatus(404);
    if (req.params.act == "dispatch") {
      const unit = req.body.unit || null;
      await q("update incidents set status='dispatched',unit=$2 where id=$1", [i.id, unit]);
      if (unit) await q("update units set st='busy' where room_id=$1 and name=$2", [i.room_id, unit]);
      await q("insert into radio(room_id,text,alert) values($1,$2,true)", [
        i.room_id,
        "DISPATCH " + (unit || "unit") + " → " + i.lga + " PU " + i.pu,
      ]);
      aud(i.room_id, "Dispatched " + unit + " to incident " + i.id);
    } else {
      await q("update incidents set status='resolved' where id=$1", [i.id]);
      if (i.unit) await q("update units set st='free' where room_id=$1 and name=$2", [i.room_id, i.unit]);
    }
    res.json({ ok: 1 });
  }),
);
app.get(
  "/api/units",
  auth(),
  h(async (req, res) => {
    const u = req.u;
    res.json(
      u.role == "obs"
        ? []
        : await q(
            "select * from units where " +
              (u.role == "room" ? "room_id=$1" : "room_id in (select id from rooms where tenant=$1)"),
            [u.role == "room" ? u.id : u.tn],
          ),
    );
  }),
);
app.post(
  "/api/units",
  auth("room"),
  h(async (req, res) => {
    const b = req.body;
    if (!b.name || isNaN(+b.lat) || isNaN(+b.lng))
      return res.status(400).json({ error: "name, lat, lng required" });
    await q("insert into units(room_id,name,lat,lng) values($1,$2,$3,$4)", [
      req.u.id,
      b.name,
      +b.lat,
      +b.lng,
    ]);
    res.json({ ok: 1 });
  }),
);
app.get(
  "/api/radio",
  auth("room"),
  h(async (req, res) =>
    res.json(
      await q(
        "select id,ts,text,alert,freq,talkgroup,unit,code,(audio_path is not null) has_audio from radio where room_id=$1 order by id desc limit 60",
        [req.u.id],
      ),
    ),
  ),
);
app.post(
  "/api/radio",
  auth("room"),
  h(async (req, res) => {
    await q("insert into radio(room_id,text) values($1,$2)", [
      req.u.id,
      String(req.body.text || "").slice(0, 300),
    ]);
    res.json({ ok: 1 });
  }),
);
