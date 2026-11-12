const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- messages (isolation enforced here) ----
app.get(
  "/api/messages",
  auth(),
  h(async (req, res) => {
    const u = req.u;
    const codes = await roomCodes(u),
      loc = await obsLoc(u);
    const all = await q("select * from messages where tenant=$1 order by id desc limit 300", [u.tn]);
    res.json(all.filter((m) => canSee(u, m, codes, loc)));
  }),
);
// who may see a message (also used to authorise acknowledgements)
// "State|LGA|Ward" (blank = any) - a broadcast to everyone in an area
const areaMatch = (spec, l) => {
  const [s, g, w] = String(spec).split("|");
  return !!l && (!s || s == l.state) && (!g || g == l.lga) && (!w || w == l.ward);
};
const obsLoc = async (u) => (u.role == "obs" ? (await q("select state,lga,ward from observers where code=$1", [u.id]))[0] : null);
const canSee = (u, m, codes, loc) =>
      u.role == "cmd"
        ? m.from_id == "CMD" || m.to_scope == "CMD"
        : u.role == "room"
          ? m.to_scope == "ALL_ROOMS" ||
            m.to_scope == "room:" + u.id ||
            m.from_id == u.id ||
            (m.to_scope.startsWith("rooms:") && m.to_scope.slice(6).split(",").includes(u.id)) ||
            codes.includes(m.from_id) ||
            codes.some((c) => m.to_scope == "obs:" + c) ||
            m.to_scope == "robs:" + u.id
          : m.to_scope == "ALL_OBS" ||
            (m.to_scope.startsWith("area:") && areaMatch(m.to_scope.slice(5), loc)) ||
            m.to_scope == "obs:" + u.id ||
            m.to_scope == "robs:" + u.room ||
            m.from_id == u.id;
const roomCodes = async (u) =>
  u.role == "room" ? (await q("select code from observers where room_id=$1", [u.id])).map((x) => x.code) : [];
async function tenantTarget(u, to) {
  if (to == "ALL_ROOMS" || to == "ALL_OBS") return true;
  if (to.startsWith("room:")) return mine(u, to.slice(5));
  if (to.startsWith("rooms:")) {
    const ids = to.slice(6).split(",");
    return (
      (await q("select count(*)::int n from rooms where tenant=$1 and id=any($2)", [u.tn, ids]))[0].n ==
      ids.length
    );
  }
  if (to.startsWith("obs:")) return !!(await own(u, to.slice(4)));
  return false;
}
app.post(
  "/api/messages",
  auth(),
  h(async (req, res) => {
    const u = req.u,
      b = req.body;
    let to = String(b.to || ""),
      text = String(b.text || "")
        .trim()
        .slice(0, 1000),
      cmd = null;
    if (!text) return res.status(400).json({ error: "Empty message" });
    if (u.role == "obs") to = "room:" + u.room;
    else if (u.role == "room") {
      if (to.startsWith("obs:")) {
        if (!(await own(u, to.slice(4)))) return res.sendStatus(403);
        if (b.cmd == "save") cmd = "save";
      } else if (to != "CMD" && to != "robs:" + u.id) return res.sendStatus(403);
    } else {
      if (to.startsWith("obs:") && b.cmd == "save") cmd = "save";
      if (!/^(ALL_ROOMS|ALL_OBS|room:.+|rooms:.+|obs:.+)$/.test(to)) return res.sendStatus(400);
      if (!(await tenantTarget(u, to))) return res.sendStatus(403);
    }
    await q("insert into messages(from_id,to_scope,text,cmd,tenant) values($1,$2,$3,$4,$5)", [
      u.id,
      to,
      text,
      cmd,
      u.tn,
    ]);
    aud(u.id, "Message → " + to);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/messages/:id/ack",
  auth(),
  h(async (req, res) => {
    const [m] = await q("select * from messages where id=$1 and tenant=$2", [+req.params.id || 0, req.u.tn]);
    if (!m || !canSee(req.u, m, await roomCodes(req.u), await obsLoc(req.u))) return res.sendStatus(404);
    await q("update messages set ack=ack||to_jsonb($2::text) where id=$1 and not ack @> to_jsonb($2::text)", [
      req.params.id,
      req.u.id,
    ]);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/broadcast",
  auth("cmd"),
  h(async (req, res) => {
    const b = req.body,
      text = String(b.text || "").trim();
    if (!text) return res.status(400).json({ error: "Empty message" });
    let to = b.target;
    if (to == "SUB") {
      const ids = (
        await q("select id from rooms where tenant=$1 and id=any($2)", [req.u.tn, (b.ids || []).map(String)])
      ).map((x) => x.id);
      if (!ids.length) return res.status(400).json({ error: "Select at least one of your rooms" });
      to = "rooms:" + ids.join(",");
    }
    if (to == "AREA") {
      // by area: Situation Rooms that cover it, or every observer in it (state, LGA or ward)
      const st = String(b.state || ""),
        lga = String(b.lga || "").trim(),
        ward = String(b.ward || "").trim(),
        [t] = await q("select state from tenants where id=$1", [req.u.tn]);
      if (!STATES.includes(st)) return res.status(400).json({ error: "Choose a state" });
      if (t?.state && t.state != st) return res.status(403).json({ error: "This Command Center covers " + t.state + " only" });
      if (ward && !lga) return res.status(400).json({ error: "Choose the LGA of that ward" });
      if (b.audience == "obs") {
        const [n] = await q(AREA_OBS, [req.u.tn, st, lga, ward]);
        if (!n.n) return res.status(400).json({ error: "No observers in that area" });
        to = "area:" + [st, lga, ward].join("|");
      } else {
        const ids = (await q("select id,scope from rooms where tenant=$1 and state=$2 and status<>'inactive' and not coalesce(archived,false)", [req.u.tn, st]))
          .filter((r) => !lga || !String(r.scope || "").trim() || String(r.scope).toLowerCase().split(",").map((x) => x.trim()).includes(lga.toLowerCase()))
          .map((r) => r.id);
        if (!ids.length) return res.status(400).json({ error: "No active Situation Room covers that area" });
        to = "rooms:" + ids.join(",");
      }
    }
    if (!["ALL_ROOMS", "ALL_OBS"].includes(to) && !String(to).startsWith("rooms:") && !String(to).startsWith("area:"))
      return res.status(400).json({ error: "Invalid target" });
    await q("insert into messages(from_id,to_scope,text,tenant) values($1,$2,$3,$4)", [
      "CMD",
      to,
      text,
      req.u.tn,
    ]);
    aud("CMD", "Broadcast → " + to);
    res.json({ ok: 1 });
  }),
);
const AREA_OBS = "select count(*)::int n from observers where active and room_id in (select id from rooms where tenant=$1 and not coalesce(archived,false)) and ($2='' or state=$2) and ($3='' or lga=$3) and ($4='' or ward=$4)";
app.get(
  "/api/broadcasts",
  auth("cmd"),
  h(async (req, res) => {
    const tn = req.u.tn,
      [r] = await q("select count(*)::int n from rooms where status='active' and tenant=$1", [tn]),
      [o] = await q(
        "select count(*)::int n from observers where active and room_id in (select id from rooms where tenant=$1)",
        [tn],
      );
    const m = await q(
      "select * from messages where tenant=$1 and from_id='CMD' and (to_scope in ('ALL_ROOMS','ALL_OBS') or to_scope like 'rooms:%' or to_scope like 'area:%') order by id desc limit 50",
      [tn],
    );
    res.json(
      await Promise.all(
        m.map(async (x) => ({
          ...x,
          targets: x.to_scope == "ALL_ROOMS" ? r.n : x.to_scope == "ALL_OBS" ? o.n : x.to_scope.startsWith("area:") ? (await q(AREA_OBS, [tn, ...x.to_scope.slice(5).split("|")]))[0].n : x.to_scope.slice(6).split(",").length,
        })),
      ),
    );
  }),
);
app.post(
  "/api/share",
  auth("cmd", "room"),
  h(async (req, res) => {
    const o = await own(req.u, req.body.code);
    if (!o) return res.sendStatus(403);
    aud(req.u.id, "Shared feed " + o.code + " → " + req.body.to);
    {
      const hk = JSON.parse((await getS("share_hooks:" + req.u.tn)) || "{}")[req.body.to];
      if (hk)
        fetch(hk, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "feed_shared",
            by: req.u.id,
            observer: o.code,
            room: o.room_id,
            state: o.state,
            lga: o.lga,
            ward: o.ward,
            pu: o.pu,
            lat: o.lat,
            lng: o.lng,
            ts: new Date(),
          }),
          signal: AbortSignal.timeout(15000),
        }).catch((e) => console.log("share hook", e.message));
    }
    if (req.u.role == "room" && req.body.to == "Command Center")
      await q("insert into messages(from_id,to_scope,text,tenant) values($1,$2,$3,$4)", [
        req.u.id,
        "CMD",
        "Feed shared: " + o.code + " (" + o.lga + " PU " + o.pu + ")",
        req.u.tn,
      ]);
    res.json({ ok: 1 });
  }),
);
