// Load test at Kano scale: 11,200 PUs x 2 observers = 22,400 observers, ~10 parties each.
//   LOAD_DATABASE_URL=postgres://postgres@localhost:5432/collation_load node test/load.js
const { spawn } = require("child_process");
const { Client } = require("pg");
const jwt = require("jsonwebtoken"), crypto = require("crypto"), path = require("path"), fs = require("fs"), os = require("os");
const DB = process.env.LOAD_DATABASE_URL || "postgres://postgres@localhost:5432/collation_load";
const PORT = 3966, B = "http://127.0.0.1:" + PORT, SECRET = "load-secret", NPU = +process.env.NPU || 11200;
const P = ["APC", "PDP", "NNPP", "ADC", "NDC", "LP", "SDP", "APGA", "YPP", "AA"];
const get = async (p, t) => { const s = Date.now(), r = await fetch(B + "/api/" + p, { headers: { Authorization: "Bearer " + t } }); const b = await r.arrayBuffer(); if (!r.ok) throw new Error(p + " " + r.status); return [Date.now() - s, b.byteLength]; };
(async () => {
  const u = new URL(DB), adm = new URL(DB); adm.pathname = "/postgres";
  let c = new Client({ connectionString: adm.href }); await c.connect();
  await c.query(`drop database if exists "${u.pathname.slice(1)}" with (force)`); await c.query(`create database "${u.pathname.slice(1)}"`); await c.end();
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, DATABASE_URL: DB, PORT, JWT_SECRET: SECRET, COMMAND_PASSCODE: "adminpass1", SEED_LOCATIONS: "0", BACKUP_MINS: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "l-")) }, stdio: "ignore" });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(B + "/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
    c = new Client({ connectionString: DB }); await c.connect();
    const ROOMS = 44; // e.g. one Situation Room per Kano LGA
    await c.query("insert into rooms(id,name,state,status,tenant,pass_hash) select 'SR-KN-'||g,'Room '||g,'Kano','active','CC-MAIN','x' from generate_series(1,$1) g", [ROOMS]);
    const dh = crypto.createHash("sha256").update("dev").digest("hex");
    await c.query(`insert into observers(code,room_id,state,lga,ward,pu,reg,device_hash,lat,lng,seen)
      select 'OBS-'||g||'-'||k,'SR-KN-'||(1+g%$2),'Kano','LGA'||(1+g%$2),'Ward'||(g%400),lpad(g::text,5,'0'),700,$3,11.5+random(),8.0+random(),now()
      from generate_series(1,$1) g, generate_series(1,2) k`, [NPU, ROOMS, dh]);
    await c.query(`insert into tallies(code,party,v) select o.code,p,(abs(hashtext(o.pu||p))%60) + case when o.code like '%-2' and p='PDP' and o.pu::int%10=0 then 1 else 0 end from observers o, unnest($1::text[]) p`, [P]);
    await c.query("analyze");
    const n = (await c.query("select count(*)::int n from tallies")).rows[0].n;
    console.log(`seeded ${NPU} PUs, ${NPU * 2} observers, ${n} tallies, ${ROOMS} rooms`);
    const A = (await (await fetch(B + "/api/login/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: "admin", pass: "adminpass1" }) })).json()).token;
    const R = jwt.sign({ role: "room", id: "SR-KN-1" }, SECRET);
    for (const [name, p, t] of [["command collation (cold)", "collation?level=lga", A], ["command collation (cached)", "collation?level=lga", A], ["command observer list", "obs", A], ["command PU review (disputed)", "pus?status=disputed", A], ["room collation", "collation?level=ward", R], ["room observer list", "obs", R]]) {
      const [ms, bytes] = await get(p, t);
      console.log(name.padEnd(32), String(ms).padStart(6) + " ms", (bytes / 1024).toFixed(0).padStart(7) + " KB");
    }
    // heartbeat storm: every observer sends GPS every 15 s (5 s only while streaming)
    const toks = (await c.query("select code,room_id from observers limit 2000")).rows.map((o) => jwt.sign({ role: "obs", id: o.code, room: o.room_id, dh: dh.slice(0, 16) }, SECRET));
    let done = 0, fail = 0;
    const end = Date.now() + 10000;
    await Promise.all(Array.from({ length: 100 }, async (_, w) => {
      for (let i = w; Date.now() < end; i += 100) {
        const r = await fetch(B + "/api/observer/heartbeat", { method: "POST", headers: { Authorization: "Bearer " + toks[i % toks.length], "Content-Type": "application/json" }, body: JSON.stringify({ lat: 12, lng: 8.5, streaming: false }) }).catch(() => null);
        r && r.ok ? done++ : fail++;
        await r?.arrayBuffer();
      }
    }));
    console.log(`heartbeats: ${(done / 10).toFixed(0)} req/s sustained (${fail} failed); needed for ${NPU * 2} observers at 1 per 15 s: ${((NPU * 2) / 15).toFixed(0)} req/s`);
    await c.end();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
