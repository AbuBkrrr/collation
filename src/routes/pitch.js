const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
// ---- Public marketing pitch page + first-party open analytics (platform administrator only) ----
// The page is served at /pitch and posts a view beacon to /api/pitch/view. No third-party tracker; the
// data lives in your own database. Share links as https://<domain>/pitch?ref=<label> to attribute opens.
app.get("/pitch", (req, res) => res.sendFile(path.join(__dirname, "..", "..", "public", "pitch", "index.html")));

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
function parseUA(ua) {
  ua = ua || "";
  const device = /Mobi|Android.+Mobile|iPhone|iPod/.test(ua) ? "Mobile" : /iPad|Tablet|Android/.test(ua) ? "Tablet" : "Desktop";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Other";
  return { device, os, browser };
}
app.post(
  "/api/pitch/view",
  h(async (req, res) => {
    if (hit("pv:" + req.ip, 60, 60000)) return res.sendStatus(429);
    const b = req.body || {},
      ua = clip(req.headers["user-agent"], 400) || "",
      d = parseUA(ua),
      // per-day salted hash of the IP: lets us count unique visitors without storing anyone's address
      iph = crypto.createHmac("sha256", SECRET).update((req.ip || "") + new Date().toISOString().slice(0, 10)).digest("hex").slice(0, 32);
    await qsys(
      "insert into pitch_views(ref,device,os,browser,ua,referrer,screen,tz,iph) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [clip(b.ref, 60), d.device, d.os, d.browser, ua, clip(req.headers["referer"], 300), clip(b.screen, 20), clip(b.tz, 60), iph],
    );
    res.json({ ok: 1 });
  }),
);
// A visitor's phone number cannot be read from the browser — there is no such web API. So the pitch
// page offers an optional "request a demo / leave your number" form; what people type is captured here
// as a lead (with the same device/os/browser context as the open) and shown in Marketing → Leads.
app.post(
  "/api/pitch/lead",
  h(async (req, res) => {
    if (hit("pl:" + req.ip, 20, 60000)) return res.sendStatus(429);
    const b = req.body || {},
      phone = clip(b.phone, 40),
      name = clip(b.name, 80);
    if (!phone && !name) return res.status(400).json({ error: "A name or phone is required" });
    const ua = clip(req.headers["user-agent"], 400) || "",
      d = parseUA(ua),
      iph = crypto.createHmac("sha256", SECRET).update((req.ip || "") + new Date().toISOString().slice(0, 10)).digest("hex").slice(0, 32);
    await qsys(
      "insert into pitch_leads(ref,name,phone,org,note,device,os,browser,iph) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [clip(b.ref, 60), name, phone, clip(b.org, 80), clip(b.note, 400), d.device, d.os, d.browser, iph],
    );
    res.json({ ok: 1 });
  }),
);
// stats for the platform administrator only
app.get(
  "/api/pitch/stats",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const days = Math.min(90, Math.max(1, +req.query.days || 30)),
      w = "ts > now() - interval '" + days + " days'";
    const grp = (col) => qsys("select coalesce(" + col + ",'(unknown)') k,count(*)::int n,count(distinct iph)::int u from pitch_views where " + w + " group by 1 order by n desc limit 25");
    const [tot] = await qsys("select count(*)::int views,count(distinct iph)::int uniques,count(*) filter (where ts::date=now()::date)::int today from pitch_views where " + w);
    res.json({
      days,
      total: tot,
      byDevice: await grp("device"),
      byOs: await grp("os"),
      byBrowser: await grp("browser"),
      byRef: await grp("ref"),
      byReferrer: await grp("nullif(referrer,'')"),
      byDay: await qsys("select to_char(ts::date,'YYYY-MM-DD') k,count(*)::int n,count(distinct iph)::int u from pitch_views where " + w + " group by 1 order by 1"),
      recent: await qsys("select ts,ref,device,os,browser,referrer from pitch_views where " + w + " order by id desc limit 40"),
      leads: await qsys("select ts,ref,name,phone,org,note,device,os,browser from pitch_leads where " + w + " order by id desc limit 100"),
      leadCount: (await qsys("select count(*)::int c from pitch_leads where " + w))[0].c,
    });
  }),
);
