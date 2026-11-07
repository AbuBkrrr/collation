const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("./core");
// ---- locations (national PU dataset import) ----
const slug = (s) =>
  String(s || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
const SMAP = Object.fromEntries(STATES.map((s) => [s.toLowerCase().replace(/[^a-z]/g, ""), s]));
Object.assign(SMAP, { abuja: "FCT", federalcapitalterritory: "FCT", fctabuja: "FCT" });
function parseLocations(d) {
  const out = [],
    pad = (n) => String(n).padStart(3, "0"),
    st = (s) =>
      SMAP[
        String(s || "")
          .toLowerCase()
          .replace(/[^a-z]/g, "")
      ];
  let skip = 0;
  if (d && !Array.isArray(d)) d = d.data || d.states || Object.values(d);
  if (!Array.isArray(d)) d = [];
  if (d.length && d[0].lgas) {
    for (const s of d) {
      const S = st(s.state);
      if (!S) {
        skip++;
        continue;
      }
      for (const l of s.lgas)
        for (const w of l.wards)
          (w.polling_units || []).forEach((p, i) => {
            const o = typeof p == "string" ? { name: p } : p;
            out.push([
              S,
              slug(l.lga),
              slug(w.ward),
              String(o.code || o.pu_code || pad(i + 1)),
              +o.reg || +o.registered_voters || 500,
              slug(o.name || o.pu_name || ""),
            ]);
          });
    }
  } else {
    const seq = {};
    for (const o of d) {
      const S = st(o.state || o.state_name);
      if (!S) {
        skip++;
        continue;
      }
      const l = slug(o.lga || o.lga_name),
        w = slug(o.ward || o.ward_name),
        k = S + l + w;
      seq[k] = (seq[k] || 0) + 1;
      out.push([
        S,
        l,
        w,
        String(o.pu_code || o.code || o.pu || pad(seq[k])),
        +o.reg || +o.registered_voters || 500,
        slug(o.pu_name || o.name || ""),
      ]);
    }
  }
  return { rows: out, skip };
}
async function loadLocations(data, append) {
  const { rows, skip } = parseLocations(data);
  if (!rows.length) throw new Error("No valid rows found — check the file format");
  const c = await pool.connect();
  try {
    await c.query("begin");
    if (!append) await c.query("truncate locations");
    for (let i = 0; i < rows.length; i += 2000) {
      const x = rows.slice(i, i + 2000);
      await c.query(
        "insert into locations(state,lga,ward,pu,reg,name) select * from unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::int[],$6::text[])",
        [0, 1, 2, 3, 4, 5].map((k) => x.map((r) => r[k])),
      );
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  const [t] = await q(
    "select count(distinct (state,lga))::int l,count(distinct (state,lga,ward))::int w,count(*)::int p from locations",
  );
  return { imported: rows.length, skipped: skip, lgas: t.l, wards: t.w, pus: t.p };
}
const SEED = path.join(__dirname, "..", "seed", "locations.json");
module.exports = { parseLocations, loadLocations, SEED, slug };
