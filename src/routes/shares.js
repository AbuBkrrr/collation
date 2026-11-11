const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
const { puList } = require("./results");
const push = (pred, m) => require("../ws").push(pred, m);
// ---- Shared live dashboard: a view-only page (map, collation, video + optional talk-back) for a chosen
// set of observers, opened by anyone holding the link AND the passcode. It has no control endpoints:
// share sessions are signed with their own secret, so the token is rejected by every other route. ----
const SHARE_SECRET = crypto.createHmac("sha256", SECRET).update("share-view").digest("hex");
const lkOn = () => LK && E.LIVEKIT_URL && E.LIVEKIT_API_KEY && E.LIVEKIT_API_SECRET;
const pub = (s) => ({
  token: s.token,
  label: s.label,
  room_id: s.room_id,
  observers: s.codes ? s.codes.length : null, // null = every observer in scope
  talkback: s.talkback,
  active: s.active && !(s.expires_at && new Date(s.expires_at) < new Date()),
  created_by: s.created_by,
  created_at: s.created_at,
  expires_at: s.expires_at,
});
// ---- operator side (Command Centre or Situation Room) ----
app.post(
  "/api/shares",
  auth("cmd", "room"),
  h(async (req, res) => {
    const b = req.body || {},
      u = req.u,
      label = String(b.label || "").trim().slice(0, 80) || "Live dashboard",
      room = u.role == "room" ? u.id : b.room ? String(b.room) : null;
    if (room && u.role == "cmd" && !(await mine(u, room))) return res.sendStatus(403);
    let codes = null;
    if (Array.isArray(b.codes) && b.codes.length) {
      const want = [...new Set(b.codes.map((c) => String(c).toUpperCase()))].slice(0, 2000);
      // q() runs under row-level security, so only this command's (and, for a room, this room's) observers match
      const ok = await q("select code from observers where code=any($1)" + (room ? " and room_id=$2" : ""), room ? [want, room] : [want]);
      if (ok.length != want.length) return res.status(400).json({ error: "Some of those observers are not yours to share" });
      codes = ok.map((x) => x.code);
    }
    const typed = String(b.pass || "");
    if (typed && typed.length < 6) return res.status(400).json({ error: "Passcode must be at least 6 characters" });
    const pass = typed || rnd(8),
      hours = Math.min(24 * 30, Math.max(0, +b.hours || 0)),
      token = crypto.randomBytes(18).toString("base64url");
    await q(
      "insert into shares(token,tenant,room_id,label,pass_hash,codes,talkback,created_by,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,case when $9>0 then now()+($9||' hours')::interval end)",
      [token, u.tn, room, label, await bcrypt.hash(pass, 10), codes, !!b.talkback, u.role == "cmd" ? "CMD:" + u.name : u.id, hours],
    );
    aud(u.role == "cmd" ? "CMD" : u.id, "Shared live dashboard '" + label + "' (" + (codes ? codes.length + " observers" : room ? "room " + room : "whole command") + (b.talkback ? ", talk-back" : "") + ")");
    res.json({ token, passcode: pass, path: "/share/#" + token, label });
  }),
);
app.get(
  "/api/shares",
  auth("cmd", "room"),
  h(async (req, res) => res.json((await q("select * from shares order by created_at desc limit 200")).map(pub))),
);
app.post(
  "/api/shares/:token/revoke",
  auth("cmd", "room"),
  h(async (req, res) => {
    const r = await qx("update shares set active=false where token=$1", [req.params.token]);
    if (!r.rowCount) return res.sendStatus(404);
    aud(req.u.role == "cmd" ? "CMD" : req.u.id, "Revoked a shared live dashboard");
    res.json({ ok: 1 });
  }),
);
// ---- viewer side (public: link + passcode) ----
const live = async (token) => {
  const [s] = await qsys("select s.*,t.active ta from shares s join tenants t on t.id=s.tenant where s.token=$1", [String(token || "")]);
  return s && s.active && s.ta && !(s.expires_at && new Date(s.expires_at) < new Date()) ? s : null;
};
app.post(
  "/api/share/open",
  h(async (req, res) => {
    const token = String(req.body?.token || "");
    if (hit("so:" + req.ip, 30, 60000) || hit("st:" + token, 20, 300000))
      return res.status(429).json({ error: "Too many attempts, wait a few minutes" });
    const s = await live(token);
    // same answer for a wrong link and a wrong passcode
    if (!s || !(await bcrypt.compare(String(req.body?.pass || ""), s.pass_hash)))
      return res.status(401).json({ error: "Wrong passcode, or this link is no longer active" });
    res.json({ token: jwt.sign({ role: "share", sid: s.token }, SHARE_SECRET, { expiresIn: "12h" }), label: s.label });
  }),
);
const shareAuth = async (req, res, next) => {
  try {
    const u = jwt.verify((req.headers.authorization || "").slice(7), SHARE_SECRET),
      s = u.role == "share" && (await live(u.sid));
    if (!s) return res.status(401).json({ error: "This shared view has ended" });
    req.s = s;
    req.u = { role: "share", tn: s.tenant }; // only so write notifications go to this command, not everyone
    // run the handler inside this command's row-level-security scope (and the room's, if room-scoped)
    als.run({ name: "share", tn: s.tenant, room: s.room_id || "" }, () => next());
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
};
const allowed = async (s) =>
  q(
    "select code,name,room_id,state,lga,ward,pu,pu_name,lat,lng,acc,seen,streaming,live_req from observers where active" +
      (s.codes ? " and code=any($1)" : "") +
      " order by lga,ward,pu,code",
    s.codes ? [s.codes] : [],
  );
// viewers currently watching each observer; a feed that a shared view switched on is switched off again
// once nobody has been watching it for a while (saves the observer's data and battery)
const watching = new Map(); // code -> { t: last seen, by: share started it }
setInterval(async () => {
  for (const [code, w] of watching)
    if (Date.now() - w.t > 60000) {
      watching.delete(code);
      if (w.by) {
        await qsys("update observers set live_req=false where code=$1", [code]).catch(() => {});
        push((c) => c.u.role == "obs" && c.u.id == code, { type: "live", on: false, by: "share" });
        bus.dirty();
      }
    }
}, 20000).unref();
app.get(
  "/api/share/state",
  shareAuth,
  h(async (req, res) => {
    const s = req.s,
      obs = await allowed(s),
      set = new Set(obs.map((o) => o.code)),
      w = String(req.query.watching || "");
    if (w && set.has(w) && watching.has(w)) watching.get(w).t = Date.now();
    // results of the polling units these observers cover
    const pus = (await puList({ role: s.room_id ? "room" : "cmd", id: s.room_id || "share", tn: s.tenant }, {}))
      .filter((x) => x.obs.some((o) => set.has(o.code)))
      .map((x) => ({ key: x.key, state: x.state, lga: x.lga, ward: x.ward, pu: x.pu, pu_name: x.pu_name, status: x.status, fig: x.fig, total: x.total, verified: x.verified, ec8a: x.ec8a, codes: x.obs.map((o) => o.code).filter((c) => set.has(c)) }));
    res.json({
      label: s.label,
      talkback: s.talkback,
      lk: !!lkOn(),
      parties: PARTIES,
      appName: await appName(s.tenant),
      observers: obs.map((o) => ({ code: o.code, lga: o.lga, ward: o.ward, pu: o.pu, pu_name: o.pu_name, lat: o.lat, lng: o.lng, acc: o.acc, seen: o.seen, streaming: o.streaming })),
      pus,
    });
  }),
);
app.post(
  "/api/share/watch",
  shareAuth,
  h(async (req, res) => {
    const s = req.s,
      code = String(req.body?.code || "");
    if (!lkOn()) return res.status(501).json({ error: "Live video is not enabled on this server" });
    const [o] = await q("select code,live_req from observers where active and code=$1" + (s.codes ? " and code=any($2)" : ""), s.codes ? [code, s.codes] : [code]);
    if (!o) return res.sendStatus(403);
    const prev = watching.get(code);
    watching.set(code, { t: Date.now(), by: prev ? prev.by : !o.live_req });
    if (!o.live_req) {
      await q("update observers set live_req=true where code=$1", [code]);
      push((c) => c.u.role == "obs" && c.u.id == code, { type: "live", on: true, by: "share" });
    }
    const at = new LK.AccessToken(E.LIVEKIT_API_KEY, E.LIVEKIT_API_SECRET, { identity: "share:" + rnd(6), name: "Viewer", ttl: "2h" });
    at.addGrant({
      room: "obs-" + code,
      roomJoin: true,
      canSubscribe: true,
      canPublish: !!s.talkback, // audio only, and only when the share allows talk-back
      canPublishSources: s.talkback ? [LK.TrackSource.MICROPHONE] : [],
      canPublishData: false,
    });
    res.json({ token: await at.toJwt(), url: E.LIVEKIT_URL, talkback: s.talkback });
  }),
);
