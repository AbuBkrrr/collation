const {LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("../core");
const { loadLocations, SEED } = require("../locations");
app.post(
  "/api/locations/import",
  auth("cmd"),
  su,
  express.json({ limit: "100mb" }),
  h(async (req, res) => {
    let d = req.body;
    if (typeof d == "string") {
      d = d
        .split(/\r?\n/)
        .map((l) => l.split(",").map((x) => x.trim().replace(/^"|"$/g, "")))
        .filter((r) => r.length >= 4);
      if (/^state$/i.test(d[0]?.[0])) d.shift();
      d = d.map((r) => ({ state: r[0], lga: r[1], ward: r[2], pu: r[3], reg: r[4], name: r[5] }));
    }
    const r = await loadLocations(d, req.query.append == "1");
    aud("CMD", "Imported " + r.imported + " location rows");
    res.json(r);
  }),
);
app.post(
  "/api/locations/fetch",
  auth("cmd"),
  su,
  h(async (req, res) => {
    const u = req.body.url;
    let d;
    if (u) {
      const r = await fetch(u, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error("Source returned HTTP " + r.status);
      d = await r.json();
    } else d = JSON.parse(fs.readFileSync(SEED, "utf8"));
    const x = await loadLocations(d, false);
    aud("CMD", "Loaded locations from " + (u || "bundled dataset") + ": " + x.imported);
    res.json(x);
  }),
);
app.get(
  "/api/locations",
  auth("cmd", "room"),
  h(async (req, res) => {
    const { state, lga, ward } = req.query;
    res.json(
      ward
        ? await q("select pu,reg,name from locations where state=$1 and lga=$2 and ward=$3 order by pu", [
            state,
            lga,
            ward,
          ])
        : lga
          ? await q("select distinct ward from locations where state=$1 and lga=$2 order by 1", [state, lga])
          : await q("select distinct lga from locations where state=$1 order by 1", [state]),
    );
  }),
);
