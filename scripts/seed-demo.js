// Demo seeder: fills the running system with a believable Kano election in progress, so a client demo
// looks like election night, not a blank screen. Safe and repeatable: it only touches the demo
// Command Center (CC-DEMO) and rewrites it each run. Never touches your real data.
//
//   DATABASE_URL=postgres://postgres@localhost:5432/collation node scripts/seed-demo.js
//
// Run it AFTER the system has started once (so the tables exist). Then log in at /command/ as
// operator "demo", passcode "demo1234".
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgres://postgres@localhost:5432/collation" });
const DATA = path.resolve(process.env.DATA_DIR || "./data");
const q = (s, a) => pool.query(s, a).then((r) => r.rows);
const rnd = (n) => { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from(crypto.randomBytes(n), (b) => c[b % c.length]).join(""); };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const jit = (n) => (Math.random() - 0.5) * n;

// The six parties the collation shows (match these in your PARTIES setting so they appear on screen).
const PARTIES = ["APC", "PDP", "ADC", "LP", "NDC", "APN"];
// Kano LGAs used for the demo, each with an approximate map centre and a couple of wards.
const LGAS = [
  { lga: "Dala", lat: 12.015, lng: 8.515, wards: ["Gwammaja", "Kofar Mazugal"] },
  { lga: "Fagge", lat: 12.005, lng: 8.520, wards: ["Fagge A", "Sabon Gari"] },
  { lga: "Nassarawa", lat: 11.992, lng: 8.552, wards: ["Hotoro", "Gyadi-Gyadi"] },
  { lga: "Tarauni", lat: 11.972, lng: 8.560, wards: ["Unguwa Uku", "Kawaji"] },
  { lga: "Gwale", lat: 11.984, lng: 8.503, wards: ["Dorayi", "Gwale"] },
  { lga: "Kano Municipal", lat: 12.000, lng: 8.516, wards: ["Zango", "Shahuci"] },
];
const PU_NAMES = ["Central Primary School", "Community Hall", "Model Primary School", "Health Centre", "Market Square", "Juma'at Mosque", "Town Hall", "Islamiyya School"];
const FIRST = ["Aisha", "Bello", "Ibrahim", "Fatima", "Musa", "Zainab", "Yusuf", "Halima", "Sani", "Maryam", "Abdullahi", "Amina"];

async function main() {
  // tables must already exist (created by the server on first start)
  await q("select 1 from rooms limit 1").catch(() => { throw new Error("Run the system once first so the database tables exist, then run this seeder."); });

  console.log("Clearing any previous demo data (CC-DEMO only)...");
  const inRooms = "room_id in (select id from rooms where tenant='CC-DEMO')";
  await q("delete from tallies where code in (select code from observers where " + inRooms + ")");
  for (const t of ["ec8a", "pu_results", "incidents", "units", "radio", "observers"]) await q("delete from " + t + " where " + inRooms);
  await q("delete from radio_keys where " + inRooms);
  await q("delete from contacts where tenant='CC-DEMO'");
  await q("delete from messages where tenant='CC-DEMO'");
  await q("delete from audit where tenant='CC-DEMO'");
  await q("delete from rooms where tenant='CC-DEMO'");
  await q("delete from cmd_users where tenant='CC-DEMO'");
  await q("delete from tenants where id='CC-DEMO'");

  console.log("Creating the demo Command Center...");
  await q("insert into tenants(id,name,active,state) values('CC-DEMO','Kano State Command (Demo)',true,'Kano')");
  await q("insert into cmd_users(name,pass_hash,tenant,su,active) values('demo',$1,'CC-DEMO',false,true)", [await bcrypt.hash("demo1234", 10)]);

  const dh = crypto.createHash("sha256").update("demo-device").digest("hex");
  let totalObs = 0, disputedDone = false, verifiedDone = false, puSeq = 0;

  for (const L of LGAS) {
    const id = "SR-KN-" + rnd(3);
    await q("insert into rooms(id,name,state,scope,operator,pass_hash,status,activated_at,tenant,last_seen) values($1,$2,'Kano',$3,$4,$5,'active',now(),'CC-DEMO',now())",
      [id, L.lga + " LGA Situation Room", L.lga, "Supervisor " + pick(FIRST), await bcrypt.hash("room1234", 10)]);

    // a handful of polling units per LGA; two PUs get two observers (to show matched / disputed)
    const puCount = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < puCount; i++) {
      puSeq++;
      const ward = pick(L.wards), pu = String(puSeq).padStart(3, "0"), puName = pick(PU_NAMES), reg = 450 + Math.floor(Math.random() * 500);
      const twoObs = i < 2; // first two PUs of each LGA have two observers
      // a base result for this PU
      const base = {}; PARTIES.forEach((p) => (base[p] = Math.floor(Math.random() * 180) + (p === "APC" || p === "NNPP" ? 120 : 10)));
      const makeObs = async (second) => {
        const code = "OBS-" + (1000 + Math.floor(Math.random() * 9000)) + "-PU" + pu + "-KN";
        const streaming = Math.random() < 0.18;
        await q("insert into observers(code,room_id,name,state,lga,ward,pu,pu_name,reg,active,lat,lng,seen,streaming,device_hash,pin_hash) values($1,$2,$3,'Kano',$4,$5,$6,$7,$8,true,$9,$10,now()-($11||' seconds')::interval,$12,$13,$14)",
          [code, id, pick(FIRST) + " " + pick(["A.", "M.", "S.", "B.", "I."]), L.lga, ward, pu, puName, reg,
           L.lat + jit(0.03), L.lng + jit(0.03), Math.floor(Math.random() * 25), streaming, dh, null]);
        // figures: the second observer usually matches; one PU disagrees; one PU gets EC8A + resolved
        const fig = {};
        PARTIES.forEach((p) => { fig[p] = base[p]; });
        if (second && twoObs && !disputedDone && i === 1) { fig.PDP += 47; fig.APC -= 12; } // a visible dispute
        const rows = PARTIES.map((p) => [code, p, fig[p]]);
        return { code, rows, fig };
      };
      const a = await makeObs(false);
      await Promise.all(a.rows.map((r) => q("insert into tallies(code,party,v,hist) values($1,$2,$3,$4)", [r[0], r[1], r[2], JSON.stringify([{ v: r[2], ts: Date.now(), src: "voice" }])])));
      totalObs++;
      if (twoObs) {
        const b = await makeObs(true);
        await Promise.all(b.rows.map((r) => q("insert into tallies(code,party,v,hist) values($1,$2,$3,$4)", [r[0], r[1], r[2], JSON.stringify([{ v: r[2], ts: Date.now(), src: "voice" }])])));
        totalObs++;
        if (i === 1 && !disputedDone) disputedDone = true;
        // one matched PU per run gets an EC8A photo + a supervisor resolution (shows "verified")
        if (i === 0 && !verifiedDone) {
          verifiedDone = true;
          const d = path.join(DATA, "ec8a", id); fs.mkdirSync(d, { recursive: true });
          // minimal valid JPEG so the EC8A button opens something
          const jpg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
          const f = path.join(d, "demo_" + pu + ".jpg"); fs.writeFileSync(f, jpg);
          await q("insert into ec8a(code,room_id,state,lga,ward,pu,path,sha256) values($1,$2,'Kano',$3,$4,$5,$6,$7)",
            [a.code, id, L.lga, ward, pu, f, crypto.createHash("sha256").update(jpg).digest("hex")]);
          await q("insert into pu_results(room_id,state,lga,ward,pu,final,by_who,note,src) values($1,'Kano',$2,$3,$4,$5,$6,$7,'manual')",
            [id, L.lga, ward, pu, JSON.stringify(a.fig), "Supervisor " + pick(FIRST), "Matches EC8A sheet"]);
        }
      }
    }

    // one or two patrol units and an incident per LGA
    await q("insert into units(room_id,name,lat,lng,st) values($1,$2,$3,$4,'free')", [id, "Patrol " + (1 + Math.floor(Math.random() * 9)), L.lat + jit(0.02), L.lng + jit(0.02)]);
    if (Math.random() < 0.6) {
      const types = ["Vote buying", "Ballot box snatching", "Overcrowding", "Late arrival of materials"];
      await q("insert into incidents(code,room_id,lga,pu,lat,lng,type,note,status) values(null,$1,$2,$3,$4,$5,$6,$7,$8)",
        [id, L.lga, String(puSeq).padStart(3, "0"), L.lat + jit(0.02), L.lng + jit(0.02), pick(types), "Reported by field observer", pick(["new", "dispatched", "resolved"])]);
    }
    // a couple of radio log lines
    await q("insert into radio(room_id,text,alert,freq,talkgroup) values($1,$2,$3,'154.3500','Command')",
      [id, pick(["Patrol en route to " + L.lga, "All units maintain vigilance", "BOLO: suspicious vehicle near market", "Materials delivered to " + L.lga]), Math.random() < 0.3]);
    // contacts
    await q("insert into contacts(room_id,name,phone,role,level,state,loc,tenant) values($1,$2,$3,'Security','LGA','Kano',$4,'CC-DEMO')",
      [id, "DPO " + L.lga, "+23480" + (10000000 + Math.floor(Math.random() * 8999999)), L.lga]);
  }

  const [{ o }] = await q("select count(*)::int o from observers where " + inRooms);
  const [{ t }] = await q("select count(*)::int t from tallies where code in (select code from observers where " + inRooms + ")");
  console.log("\n✓ Demo data ready.");
  console.log("  " + LGAS.length + " Situation Rooms · " + o + " observers (live on the map) · " + t + " tallies · incidents, radio, contacts, 1 resolved + verified PU, 1 disputed PU.");
  console.log("\n  Log in at  /command/");
  console.log("    operator: demo");
  console.log("    passcode: demo1234");
  console.log("\n  Tip: set PARTIES=APC,PDP,ADC,LP,NDC,APN,NNPP,SDP,APGA,YPP in your .env so the collation shows these parties.\n");

  if (process.argv.includes("--live")) {
    console.log("  LIVE MODE: figures keep climbing every few seconds, so the collation moves during your demo.");
    console.log("  Leave this running; press Ctrl+C to stop.\n");
    const codes = (await q("select code from observers where " + inRooms)).map((r) => r.code);
    setInterval(async () => {
      try {
        await q("update observers set seen=now() where " + inRooms); // keep everyone green on the map
        for (let i = 0; i < 6; i++) {
          const code = pick(codes), party = pick(PARTIES);
          await q("update tallies set v=v+$3 where code=$1 and party=$2", [code, party, 1 + Math.floor(Math.random() * 25)]);
        }
      } catch (e) { console.log("live tick:", e.message); }
    }, 4000);
    return; // keep the connection open
  }
  await pool.end();
}
main().catch((e) => { console.error("Seed failed:", e.message); process.exit(1); });
