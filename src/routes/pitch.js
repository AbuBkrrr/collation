const {qsys,hit,path,crypto,SECRET,h,app,auth,su} = require("../core");
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
    // Which DEVICE opened it: a random id the page keeps in the browser (vid), so reopening on the same phone is
    // recognised and a forwarded link opened elsewhere is not. dsig is a coarse device signature (model / screen /
    // timezone / language) used only when no id came through. Neither identifies a person.
    const vid = /^[A-Za-z0-9_-]{16,64}$/.test(String(b.vid || "")) ? String(b.vid) : null,
      dsig = crypto.createHmac("sha256", SECRET).update([ua, b.screen, b.tz, req.headers["accept-language"]].join("|")).digest("hex").slice(0, 16);
    await qsys(
      "insert into pitch_views(ref,device,os,browser,ua,referrer,screen,tz,iph,vid,dsig) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [clip(b.ref, 60), d.device, d.os, d.browser, ua, clip(req.headers["referer"], 300), clip(b.screen, 20), clip(b.tz, 60), iph, vid, dsig],
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
      "insert into pitch_leads(ref,name,phone,org,note,device,os,browser,iph,vid) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [clip(b.ref, 60), name, phone, clip(b.org, 80), clip(b.note, 400), d.device, d.os, d.browser, iph, /^[A-Za-z0-9_-]{16,64}$/.test(String(b.vid || "")) ? String(b.vid) : null],
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
    const DK = "coalesce(vid,dsig,iph)"; // one key per device
    const [tot] = await qsys("select count(*)::int views,count(distinct iph)::int uniques,count(distinct " + DK + ")::int devices,count(*) filter (where ts::date=now()::date)::int today from pitch_views where " + w);
    // per tracking link: how many opens, how many different devices, and how many opens were the same device coming back
    const links = await qsys(
      `select coalesce(nullif(ref,''),'(no label)') k,count(*)::int opens,count(distinct ${DK})::int devices,
        count(*)::int-count(distinct ${DK})::int repeats,min(ts) first,max(ts) last
       from pitch_views where ${w} group by 1 order by opens desc limit 50`,
    );
    tot.repeats = tot.views - tot.devices;
    res.json({
      days,
      total: tot,
      byDevice: await grp("device"),
      byOs: await grp("os"),
      byBrowser: await grp("browser"),
      byRef: await grp("nullif(ref,'')"),
      byReferrer: await grp("nullif(referrer,'')"),
      byDay: await qsys("select to_char(ts::date,'YYYY-MM-DD') k,count(*)::int n,count(distinct iph)::int u from pitch_views where " + w + " group by 1 order by 1"),
      links,
      recent: await qsys(
        `select * from (select ts,ref,device,os,browser,referrer,id,
            (row_number() over (partition by coalesce(ref,''),${DK} order by id))::int nth,
            (dense_rank() over (partition by coalesce(ref,'') order by (select min(id) from pitch_views p where coalesce(p.ref,'')=coalesce(v.ref,'') and coalesce(p.vid,p.dsig,p.iph)=coalesce(v.vid,v.dsig,v.iph)))::int) devno
          from pitch_views v where ${w}) x order by id desc limit 60`,
      ),
      leads: await qsys("select l.ts,l.ref,l.name,l.phone,l.org,l.note,l.device,l.os,l.browser,(select count(*)::int from pitch_views v where l.vid is not null and v.vid=l.vid) opens from pitch_leads l where l." + w + " order by l.id desc limit 100"),
      leadCount: (await qsys("select count(*)::int c from pitch_leads where " + w))[0].c,
    });
  }),
);
