const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- LiveKit (SFU, simulcast) + restream ----
const lkOn = () => LK && E.LIVEKIT_URL && E.LIVEKIT_API_KEY && E.LIVEKIT_API_SECRET;
app.post(
  "/api/livekit/token",
  auth(),
  h(async (req, res) => {
    if (!lkOn()) return res.status(501).json({ error: "LiveKit is not configured" });
    const u = req.u,
      code = u.role == "obs" ? u.id : String(req.body.code || "");
    if (!(await own(u, code))) return res.sendStatus(403);
    const at = new LK.AccessToken(E.LIVEKIT_API_KEY, E.LIVEKIT_API_SECRET, {
      identity: u.role + ":" + u.id + ":" + rnd(4),
      name: u.id,
      ttl: "6h",
    });
    at.addGrant({
      room: "obs-" + code,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishSources:
        u.role == "obs" ? [LK.TrackSource.CAMERA, LK.TrackSource.MICROPHONE] : [LK.TrackSource.MICROPHONE],
    });
    res.json({ token: await at.toJwt(), url: E.LIVEKIT_URL });
  }),
);
const egr = {},
  EC = () =>
    new LK.EgressClient(
      E.LIVEKIT_INTERNAL_URL || "http://livekit:7880",
      E.LIVEKIT_API_KEY,
      E.LIVEKIT_API_SECRET,
    );
app.post(
  "/api/restream",
  auth("cmd", "room"),
  h(async (req, res) => {
    const { code, url } = req.body;
    if (!lkOn()) return res.status(501).json({ error: "LiveKit is not configured" });
    if (!/^rtmps?:\/\/\S+$/i.test(url || ""))
      return res.status(400).json({ error: "Enter an rtmp:// or rtmps:// URL that includes the stream key" });
    if (!(await own(req.u, code))) return res.sendStatus(403);
    const i = await EC().startRoomCompositeEgress(
      "obs-" + code,
      { stream: new LK.StreamOutput({ protocol: LK.StreamProtocol.RTMP, urls: [url] }) },
      { layout: "speaker" },
    );
    egr[code] = i.egressId;
    aud(req.u.id, "Restream started for " + code);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/restream/stop",
  auth("cmd", "room"),
  h(async (req, res) => {
    const code = req.body.code;
    if (!(await own(req.u, code))) return res.sendStatus(403);
    if (!egr[code]) return res.status(404).json({ error: "No active restream for this observer" });
    await EC().stopEgress(egr[code]);
    delete egr[code];
    aud(req.u.id, "Restream stopped for " + code);
    res.json({ ok: 1 });
  }),
);
