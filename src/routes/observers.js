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
            : ["room_id in (select id from rooms where tenant=$1 and not coalesce(archived,false))", u.tn];
    const o = await q(
      "select code,room_id,name,state,lga,ward,pu,pu_name,reg,ec_reg,ec_acc,active,lat,lng,acc,seen,streaming,pend,live_req,(device_hash is not null) bound from observers where " +
        w[0] +
        " order by code",
      [w[1]],
    );
    const t = await q("select code,party,v,edits," + (o.length <= 2000 || u.role == "obs" || req.query.full == "1" ? "hist" : "null hist") + " from tallies where code=any($1)", [
        o.map((x) => x.code),
      ]),
      m = {};
    const full = u.role == "obs" || req.query.full == "1" || o.length <= 2000;
    t.forEach((x) => ((m[x.code] = m[x.code] || {})[x.party] = full ? { v: x.v, edits: x.edits, hist: x.hist } : { v: x.v, edits: x.edits }));
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
    // a room created for an LGA (scope) may only issue codes inside that LGA / state
    const [rm] = await q("select state,scope from rooms where id=$1", [req.u.id]),
      sc = String(rm?.scope || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (rm?.state && rm.state != b.state) return res.status(403).json({ error: "This room covers " + rm.state + " only" });
    if (sc.length && !sc.includes(String(b.lga).trim().toLowerCase()))
      return res.status(403).json({ error: "This room covers " + rm.scope + " LGA only" });
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
// ---- bulk: several LGAs / wards / polling units at once, N observers per unit (names can be added later) ----
const puNorm = (v) => String(v || "").split(/[\/-]/).pop().replace(/\D/g, "").padStart(3, "0");
app.post(
  "/api/room/obs/bulk",
  auth("room"),
  h(async (req, res) => {
    const b = req.body || {},
      per = Math.min(5, Math.max(1, parseInt(b.per, 10) || 2)),
      units = Array.isArray(b.units) ? b.units.slice(0, 3000) : [];
    if (!units.length) return res.status(400).json({ error: "Choose at least one polling unit" });
    const [rm] = await q("select state,scope from rooms where id=$1", [req.u.id]),
      sc = String(rm?.scope || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
      st = rm?.state;
    if (!STATES.includes(st)) return res.status(400).json({ error: "This room has no state" });
    const lgas = [...new Set(units.map((u) => String(u.lga || "")))];
    if (sc.length && lgas.some((l) => !sc.includes(l.trim().toLowerCase()))) return res.status(403).json({ error: "This room covers " + rm.scope + " only" });
    // every unit must exist in the state's polling-unit list; its registered voters and name come from there
    const known = new Map((await q("select lga,ward,pu,reg,name from locations where state=$1 and lga=any($2)", [st, lgas])).map((r) => [[r.lga, r.ward, r.pu].join("|"), r]));
    const bad = units.find((u) => !known.has([u.lga, u.ward, u.pu].join("|")));
    if (bad) return res.status(400).json({ error: "Not a polling unit of " + st + ": " + [bad.lga, bad.ward, bad.pu].join(" / ") });
    // top up: a unit that already has observers only gets what is missing to reach "per"
    const have = new Map((await q("select lga,ward,pu,count(*)::int n from observers where room_id=$1 and active group by 1,2,3", [req.u.id])).map((r) => [[r.lga, r.ward, r.pu].join("|"), r.n]));
    const want = [];
    let skipped = 0;
    for (const u of units) {
      const k = [u.lga, u.ward, u.pu].join("|"),
        need = per - (have.get(k) || 0);
      if (need <= 0) skipped++;
      for (let i = 0; i < need; i++) want.push({ u, r: known.get(k) });
    }
    if (!want.length) return res.json({ created: [], skipped });
    if (want.length > 5000) return res.status(400).json({ error: "That would create " + want.length + " codes; choose fewer units (max 5000)" });
    const used = new Set(),
      codes = [];
    for (const w of want) {
      let c;
      do c = "OBS-" + (1000 + crypto.randomInt(9000)) + "-PU" + puNorm(w.u.pu) + "-" + abbr(st);
      while (used.has(c));
      used.add(c);
      codes.push(c);
    }
    const clash = new Set((await q("select code from observers where code=any($1)", [codes])).map((x) => x.code));
    for (let i = 0; i < codes.length; i++)
      while (clash.has(codes[i]) || codes.indexOf(codes[i]) != i) codes[i] = "OBS-" + (1000 + crypto.randomInt(9000)) + "-PU" + puNorm(want[i].u.pu) + "-" + abbr(st);
    await q(
      `insert into observers(code,room_id,name,state,lga,ward,pu,reg,pu_name)
       select t.c,$2,'',$3,t.l,t.w,t.p,t.r,t.n from unnest($1::text[],$4::text[],$5::text[],$6::text[],$7::int[],$8::text[]) as t(c,l,w,p,r,n)`,
      [codes, req.u.id, st, want.map((w) => w.u.lga), want.map((w) => w.u.ward), want.map((w) => puNorm(w.u.pu)), want.map((w) => +w.r.reg || 500), want.map((w) => w.r.name || null)],
    );
    aud(req.u.id, "Generated " + codes.length + " observer codes in bulk (" + units.length + " polling units)");
    res.json({ created: want.map((w, i) => ({ code: codes[i], lga: w.u.lga, ward: w.u.ward, pu: puNorm(w.u.pu), pu_name: w.r.name || "", reg: +w.r.reg || 500 })), skipped });
  }),
);
// an observer's name can be added or changed any time (the room, or its Command Center)
app.post(
  "/api/obs/:code/name",
  auth("cmd", "room"),
  h(async (req, res) => {
    const o = await own(req.u, req.params.code);
    if (!o) return res.sendStatus(404);
    await q("update observers set name=$2 where code=$1", [o.code, String(req.body.name || "").trim().slice(0, 80)]);
    res.json({ ok: 1 });
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
// Heartbeat fast path (the hottest endpoint: every phone, every 15 s): token check + access check + update
// in ONE statement. Same rules as auth(): code active, room active, Command Center active, same phone.
app.post(
  "/api/observer/heartbeat",
  h(async (req, res) => {
    let u;
    try {
      u = jwt.verify((req.headers.authorization || "").slice(7), SECRET);
    } catch {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (u.role != "obs" || !u.dh) return res.status(401).json({ error: "Unauthorized" });
    const b = req.body || {},
      lat = Number.isFinite(b.lat) && Math.abs(b.lat) <= 90 ? b.lat : null,
      lng = Number.isFinite(b.lng) && Math.abs(b.lng) <= 180 ? b.lng : null,
      acc = Number.isFinite(b.acc) && b.acc >= 0 && b.acc < 100000 ? Math.round(b.acc) : null;
    const [r] = await qsys(
      `update observers o set seen=now(),lat=coalesce($2,o.lat),lng=coalesce($3,o.lng),acc=case when $2::float8 is null then o.acc else $7 end,streaming=coalesce($4,o.streaming),pend=coalesce($5,o.pend)
       from observers p join rooms r on r.id=p.room_id join tenants t on t.id=r.tenant
       where o.code=$1 and p.code=$1 and o.active and r.status='active' and t.active and left(o.device_hash,16)=$6
       returning p.streaming old,o.streaming,o.live_req,r.tenant`,
      [u.id, lat, lng, typeof b.streaming == "boolean" ? b.streaming : null, Number.isInteger(b.pend) ? b.pend : null, u.dh, acc],
    );
    if (!r) return res.status(401).json({ error: "Access revoked" });
    // only a change of streaming state is pushed at once; GPS moves reach dashboards on their 10 s refresh
    if (!!r.old != !!r.streaming) bus.notify(r.tenant);
    res.json({ ok: 1, live: !!r.live_req });
  }),
);
app.post(
  "/api/observer/tally",
  auth("obs"),
  h(async (req, res) => {
    const { party, v } = req.body;
    if (!PARTIES.includes(party) || !Number.isInteger(v) || v < 0)
      return res.status(400).json({ error: "Invalid party or number" });
    if (v > 100000) return res.status(400).json({ error: "Number too large" });
    // Each entry (spoken or typed) ADDS to the party's running total; the history keeps every entry.
    // Entry is continuous: nothing locks. A hand correction (tap the row) just sets the total; later
    // entries keep adding to it, and every change stays in the history for the room to see.
    const src = String(req.body.src || "manual").slice(0, 12),
      r = await qx(
        `insert into tallies(code,party,v,hist) values($1,$2,$3,jsonb_build_array(jsonb_build_object('v',$3::int,'add',$3::int,'ts',$4::bigint,'src',$5::text)))
         on conflict (code,party) do update set v=tallies.v+excluded.v,
           hist=tallies.hist||jsonb_build_array(jsonb_build_object('v',tallies.v+excluded.v,'add',excluded.v,'ts',$4::bigint,'src',$5::text))
         returning v`,
        [req.u.id, party, v, Date.now(), src],
      );
    const [x] = await q(
      "select sum(v)::int s,(select reg from observers where code=$1) reg from tallies where code=$1",
      [req.u.id],
    );
    res.json({ ok: 1, v: r.rows[0].v, added: v, anomaly: x.s > x.reg, total: x.s, reg: x.reg });
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
      "update tallies set v=$3,edits=edits+1,hist=hist||$4::jsonb where code=$1 and party=$2",
      [req.u.id, party, v, JSON.stringify([{ v, ts: Date.now(), src: "edit" }])],
    );
    if (!r.rowCount) return res.status(404).json({ error: "Enter a figure for " + party + " first" });
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
