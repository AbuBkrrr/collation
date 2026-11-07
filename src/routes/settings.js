const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
app.get(
  "/api/settings",
  auth("cmd"),
  h(async (req, res) => {
    const tn = req.u.tn;
    res.json({
      appName: await appName(tn),
      platformName: req.u.su ? (await getS("app_name")) || E.APP_NAME || "My Collation Center" : undefined,
      hooks: JSON.parse((await getS("share_hooks:" + tn)) || "{}"),
      cloudUrl: (await getS("cloud_url:" + tn)) || "",
      cloudMins: +(await getS("cloud_mins:" + tn)) || 0,
      cloudToken: (await getS("cloud_token:" + tn)) ? "********" : "",
    });
  }),
);
app.post(
  "/api/settings",
  auth("cmd"),
  h(async (req, res) => {
    const b = req.body,
      tn = req.u.tn;
    if (b.appName !== undefined) {
      const n = String(b.appName).trim().slice(0, 60);
      if (!n) return res.status(400).json({ error: "Name cannot be empty" });
      await setS("app_name:" + tn, n);
    }
    if (b.platformName !== undefined) {
      if (!req.u.su) return res.status(403).json({ error: "Platform administrator only" });
      const n = String(b.platformName).trim().slice(0, 60);
      if (!n) return res.status(400).json({ error: "Name cannot be empty" });
      await setS("app_name", n);
    }
    if (b.hooks) await setS("share_hooks:" + tn, JSON.stringify(b.hooks));
    if (b.cloudUrl !== undefined) await setS("cloud_url:" + tn, b.cloudUrl);
    if (b.cloudMins !== undefined) await setS("cloud_mins:" + tn, +b.cloudMins || 0);
    if (b.cloudToken && b.cloudToken != "********") await setS("cloud_token:" + tn, b.cloudToken);
    aud("CMD", "Updated settings");
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/settings/passcode",
  auth("cmd"),
  h(async (req, res) => {
    const { old, pass } = req.body,
      [s] = await q("select pass_hash v from cmd_users where lower(name)=lower($1)", [req.u.name || "admin"]);
    if (!(await bcrypt.compare(String(old || ""), s.v)))
      return res.status(403).json({ error: "Current passcode is wrong" });
    if (String(pass || "").length < 8)
      return res.status(400).json({ error: "New passcode must be at least 8 characters" });
    await q("update cmd_users set pass_hash=$2 where lower(name)=lower($1)", [
      req.u.name || "admin",
      await bcrypt.hash(String(pass), 10),
    ]);
    aud("CMD", "Changed own passcode");
    res.json({ ok: 1 });
  }),
);
const lastCloud = {};
async function cloudSync(tn) {
  const u = await getS("cloud_url:" + tn);
  if (!u) throw new Error("Cloud URL not set");
  const t = await getS("cloud_token:" + tn),
    rs = "room_id in (select id from rooms where tenant=$1)",
    obs = await q("select * from observers where " + rs, [tn]),
    r = await fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) },
      body: JSON.stringify({
        at: new Date(),
        observers: obs,
        tallies: await q("select * from tallies where code=any($1)", [obs.map((x) => x.code)]),
        incidents: await q("select * from incidents where " + rs, [tn]),
      }),
      signal: AbortSignal.timeout(60000),
    });
  if (!r.ok) throw new Error("Cloud endpoint returned HTTP " + r.status);
  lastCloud[tn] = Date.now();
  aud("CMD", "Cloud sync OK", tn);
}
app.post(
  "/api/cloudsync",
  auth("cmd"),
  h(async (req, res) => {
    await cloudSync(req.u.tn);
    res.json({ ok: 1 });
  }),
);
setInterval(async () => {
  try {
    for (const t of await q("select id from tenants where active")) {
      const m = +(await getS("cloud_mins:" + t.id));
      if (m > 0 && Date.now() - (lastCloud[t.id] || 0) > m * 60000) {
        lastCloud[t.id] = Date.now();
        await cloudSync(t.id).catch((e) => console.log("cloud sync", t.id, e.message));
      }
    }
  } catch (e) {
    console.log("cloud sync:", e.message);
  }
}, 30000);
