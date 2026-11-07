const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- observers ----
app.get(
  "/api/obs",
  auth(),
  h(async (req, res) => {
    const u = req.u,
      w =
        u.role == "room"
          ? ["room_id=$1", u.id]
          : u.role == "obs"
            ? ["code=$1", u.id]
            : ["room_id in (select id from rooms where tenant=$1)", u.tn];
    const o = await q(
      "select code,room_id,name,state,lga,ward,pu,pu_name,reg,active,lat,lng,seen,streaming,pend,live_req,(device_hash is not null) bound from observers where " +
        w[0] +
        " order by code",
      [w[1]],
    );
    const t = await q("select code,party,v,edits,hist from tallies where code=any($1)", [
        o.map((x) => x.code),
      ]),
      m = {};
    t.forEach((x) => ((m[x.code] = m[x.code] || {})[x.party] = { v: x.v, edits: x.edits, hist: x.hist }));
    res.json(o.map((x) => ({ ...x, t: m[x.code] || {} })));
  }),
);
app.post(
  "/api/room/obs",
  auth("room"),
  h(async (req, res) => {
    const b = req.body,
      pu = String(b.pu || "")
        .split(/[\/-]/)
        .pop()
        .replace(/\D/g, "")
        .padStart(3, "0"),
      [pl] = await q("select name from locations where state=$1 and lga=$2 and ward=$3 and pu=$4 limit 1", [
        b.state,
        b.lga,
        b.ward,
        String(b.pu || ""),
      ]);
    if (!STATES.includes(b.state) || !b.lga || !b.ward || !b.pu)
      return res.status(400).json({ error: "State, LGA, ward and PU are required" });
    let code;
    do code = "OBS-" + (1000 + crypto.randomInt(9000)) + "-PU" + pu + "-" + abbr(b.state);
    while ((await q("select 1 from observers where code=$1", [code])).length);
    await q(
      "insert into observers(code,room_id,name,state,lga,ward,pu,reg,pu_name) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [code, req.u.id, b.name || "", b.state, b.lga, b.ward, pu, +b.reg || 500, pl?.name || null],
    );
    aud(req.u.id, "Generated observer code " + code);
    res.json({ code });
  }),
);
app.post(
  "/api/obs/:code/toggle",
  auth("cmd", "room"),
  h(async (req, res) => {
    const o = await own(req.u, req.params.code);
    if (!o) return res.sendStatus(404);
    await q("update observers set active=not active where code=$1", [o.code]);
    aud(req.u.id, (o.active ? "Revoked " : "Activated ") + o.code);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/observer/heartbeat",
  auth("obs"),
  h(async (req, res) => {
    const b = req.body,
      lat = Number.isFinite(b.lat) && Math.abs(b.lat) <= 90 ? b.lat : null,
      lng = Number.isFinite(b.lng) && Math.abs(b.lng) <= 180 ? b.lng : null;
    const [r] = await q(
      "update observers o set seen=now(),lat=coalesce($2,o.lat),lng=coalesce($3,o.lng),streaming=coalesce($4,o.streaming),pend=coalesce($5,o.pend) from (select streaming old from observers where code=$1) p where o.code=$1 returning p.old,o.streaming,o.live_req",
      [req.u.id, lat, lng, typeof b.streaming == "boolean" ? b.streaming : null, Number.isInteger(b.pend) ? b.pend : null],
    );
    // only a change of streaming state is pushed at once; GPS moves reach dashboards on their 10 s refresh
    if (r && !!r.old != !!r.streaming) bus.notify(req.u.tn);
    res.json({ ok: 1, live: !!r?.live_req });
  }),
);
app.post(
  "/api/observer/tally",
  auth("obs"),
  h(async (req, res) => {
    const { party, v } = req.body;
    if (!PARTIES.includes(party) || !Number.isInteger(v) || v < 0)
      return res.status(400).json({ error: "Invalid party or number" });
    const r = await qx(
      "insert into tallies(code,party,v,hist) values($1,$2,$3,$4) on conflict do nothing",
      [req.u.id, party, v, JSON.stringify([{ v, ts: Date.now(), src: req.body.src || "manual" }])],
    );
    if (!r.rowCount)
      return res.status(409).json({ error: party + " already entered — correct it once by tapping the row" });
    const [x] = await q(
      "select sum(v)::int s,(select reg from observers where code=$1) reg from tallies where code=$1",
      [req.u.id],
    );
    res.json({ ok: 1, anomaly: x.s > x.reg, total: x.s, reg: x.reg });
  }),
);
app.post(
  "/api/observer/tally/edit",
  auth("obs"),
  h(async (req, res) => {
    const { party, v } = req.body;
    if (!PARTIES.includes(party) || !Number.isInteger(v) || v < 0)
      return res.status(400).json({ error: "Invalid party or number" });
    const r = await qx(
      "update tallies set v=$3,edits=1,hist=hist||$4::jsonb where code=$1 and party=$2 and edits=0",
      [req.u.id, party, v, JSON.stringify([{ v, ts: Date.now(), src: "edit" }])],
    );
    if (!r.rowCount) return res.status(409).json({ error: "This entry was already corrected once (locked)" });
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/observer/incident",
  auth("obs"),
  h(async (req, res) => {
    const b = req.body,
      [o] = await q("select * from observers where code=$1", [req.u.id]);
    const [i] = await q(
      "insert into incidents(code,room_id,lga,pu,lat,lng,type,note) values($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [
        o.code,
        o.room_id,
        o.lga,
        o.pu,
        b.lat ?? o.lat,
        b.lng ?? o.lng,
        b.silent ? "SILENT SOS" : "Incident Report",
        String(b.note || "").slice(0, 500),
      ],
    );
    aud(o.code, "Incident " + i.id);
    res.json(i);
  }),
);
