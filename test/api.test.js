// Integration tests: run against a real, throwaway PostgreSQL database.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/collation_test npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { Client } = require("pg");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const TOTP = require("../src/totp");

const DB = process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:5432/collation_test";
const PORT = 3990 + Math.floor(Math.random() * 8);
const BASE = "http://127.0.0.1:" + PORT;
let srv, S = {};

async function api(p, { tok, body, method, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (tok) h.Authorization = "Bearer " + tok;
  if (body && !raw) h["Content-Type"] = "application/json";
  const r = await fetch(BASE + "/api/" + p, { method: method || (body ? "POST" : "GET"), headers: h, body: raw ? body : body && JSON.stringify(body) });
  const ct = r.headers.get("content-type") || "";
  return { s: r.status, j: ct.includes("json") ? await r.json() : await r.text() };
}
const ok = (r) => (assert.ok(r.s < 300, JSON.stringify(r)), r.j);

before(async () => {
  const u = new URL(DB), name = u.pathname.slice(1), adm = new URL(DB);
  adm.pathname = "/postgres";
  const c = new Client({ connectionString: adm.href });
  await c.connect();
  await c.query(`drop database if exists "${name}" with (force)`);
  await c.query(`create database "${name}"`);
  await c.end();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "mcc-"));
  srv = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: DB, PORT, COMMAND_PASSCODE: "adminpass1", JWT_SECRET: "test-secret", DATA_DIR: data, SEED_LOCATIONS: "0", BACKUP_MINS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  srv.stdout.on("data", (d) => (log += d));
  srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + "/api/health")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not start:\n" + log);
});
after(() => srv && srv.kill());

const dev = (n) => "device-" + n + "-0123456789abcdef";
async function obsLogin(code, d, pin = "4321") {
  return api("login/observer", { body: { code, device: dev(d), pin } });
}

test("setup: two Command Centers, three rooms, observers", async () => {
  S.A = ok(await api("login/command", { body: { user: "admin", pass: "adminpass1" } })).token;
  ok(await api("tenants", { tok: S.A, body: { name: "Kaduna", operator: "kdop", pass: "kadunapass1" } }));
  S.B = ok(await api("login/command", { body: { user: "kdop", pass: "kadunapass1" } })).token;
  const mk = async (tok, name, state) => {
    const r = ok(await api("rooms", { tok, body: { name, state } }));
    ok(await api("rooms/" + r.id + "/status", { tok, body: { status: "active" } }));
    return { id: r.id, tok: ok(await api("login/room", { body: { id: r.id, pass: r.passcode } })).token };
  };
  S.RA = await mk(S.A, "Kano Central", "Kano");
  S.RA2 = await mk(S.A, "Kano North", "Kano");
  S.RB = await mk(S.B, "Kaduna Central", "Kaduna");
  const gen = async (r, state, lga) => ok(await api("room/obs", { tok: r.tok, body: { state, lga, ward: "Gwammaja", pu: "001", reg: 300 } })).code;
  S.o1 = await gen(S.RA, "Kano", "Dala");
  S.o2 = await gen(S.RA, "Kano", "Dala");
  S.o3 = await gen(S.RA2, "Kano", "Fagge");
  S.o4 = await gen(S.RB, "Kaduna", "Zaria");
  assert.match(S.o1, /^OBS-\d{4}-PU001-KN$/);
  assert.match(S.o4, /^OBS-\d{4}-PU001-KD$/);
  assert.match(S.RB.id, /^SR-KD-/);
});

test("observer device lock + PIN", async () => {
  assert.equal((await api("login/observer", { body: { code: S.o1 } })).s, 400);
  S.t1 = ok(await obsLogin(S.o1, 1)).token;
  assert.equal((await obsLogin(S.o1, 2)).s, 403, "second phone refused");
  assert.equal((await obsLogin(S.o1, 1, "9999")).s, 401, "wrong PIN refused");
  ok(await obsLogin(S.o1, 1));
  S.t2 = ok(await obsLogin(S.o2, 3)).token;
  S.t3 = ok(await obsLogin(S.o3, 4)).token;
  S.t4 = ok(await obsLogin(S.o4, 5)).token;
  const me = ok(await api("me", { tok: S.t1 }));
  assert.equal(me.obs.pin_hash, undefined);
  assert.equal(me.obs.device_hash, undefined);
});

test("tally entry, edit once, two-observer dispute, supervisor resolve, EC8A", async () => {
  ok(await api("observer/tally", { tok: S.t1, body: { party: "APC", v: 95 } }));
  ok(await api("observer/tally", { tok: S.t1, body: { party: "PDP", v: 50 } }));
  // a second entry for the same party adds to the running total
  assert.equal(ok(await api("observer/tally", { tok: S.t1, body: { party: "APC", v: 5, src: "voice" } })).v, 100);
  ok(await api("observer/tally", { tok: S.t2, body: { party: "APC", v: 100 } }));
  let c = ok(await api("collation", { tok: S.RA.tok }));
  assert.equal(c.sum.counts.partial, 1, "no conflict yet, still entering");
  ok(await api("observer/tally", { tok: S.t2, body: { party: "PDP", v: 60 } }));
  c = ok(await api("collation", { tok: S.RA.tok }));
  assert.equal(c.sum.counts.disputed, 1);
  assert.equal(c.sum.totals.APC, 0, "disputed PU not counted");
  ok(await api("observer/tally/edit", { tok: S.t2, body: { party: "PDP", v: 50 } }));
  // entry is continuous: a corrected total can be corrected again and keeps taking additions
  ok(await api("observer/tally/edit", { tok: S.t2, body: { party: "PDP", v: 49 } }));
  assert.equal(ok(await api("observer/tally", { tok: S.t2, body: { party: "PDP", v: 1 } })).v, 50);
  c = ok(await api("collation", { tok: S.RA.tok }));
  assert.equal(c.sum.counts.matched, 1);
  assert.equal(c.sum.totals.APC, 100);
  assert.equal(c.sum.counts.verified, 0, "no EC8A yet");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3000, 7)]);
  const ph = ok(await api("observer/ec8a", { tok: S.t1, body: jpg, raw: 1, headers: { "Content-Type": "image/jpeg" } }));
  assert.equal(ph.sha256.length, 64);
  c = ok(await api("collation", { tok: S.RA.tok }));
  assert.equal(c.sum.counts.verified, 1);
  assert.equal((await api("pus/resolve", { tok: S.RA.tok, body: { state: "Kano", lga: "Dala", ward: "Gwammaja", pu: "001", final: { APC: 101 } } })).s, 400, "note required");
  ok(await api("pus/resolve", { tok: S.RA.tok, body: { state: "Kano", lga: "Dala", ward: "Gwammaja", pu: "001", final: { APC: 101, PDP: 50 }, note: "Per EC8A photo" } }));
  c = ok(await api("collation?level=lga", { tok: S.RA.tok }));
  assert.equal(c.sum.counts.resolved, 1);
  assert.equal(c.sum.totals.APC, 101);
  assert.equal(c.rows[0].key, "Dala");
  const pus = ok(await api("pus", { tok: S.RA.tok }));
  assert.equal(pus.items[0].obs.length, 2);
  const f = await fetch(BASE + "/api/ec8a/" + ph.id + "/file", { headers: { Authorization: "Bearer " + S.RA.tok } });
  assert.equal(f.status, 200);
  S.ec = ph.id;
  // anomaly: total above registered voters
  ok(await api("observer/tally", { tok: S.t3, body: { party: "APC", v: 400 } }));
  c = ok(await api("collation", { tok: S.A }));
  assert.equal(c.sum.counts.anomaly, 1);
});

test("isolation between Command Centers and between rooms (API)", async () => {
  const codesB = ok(await api("obs", { tok: S.B })).map((o) => o.code);
  assert.deepEqual(codesB, [S.o4]);
  const codesA = ok(await api("obs", { tok: S.A })).map((o) => o.code).sort();
  assert.deepEqual(codesA, [S.o1, S.o2, S.o3].sort());
  assert.equal((await api("obs/" + S.o1 + "/toggle", { tok: S.B, body: {} })).s, 404);
  assert.equal((await api("obs/" + S.o1 + "/live", { tok: S.RA2.tok, body: { on: true } })).s, 404);
  assert.equal((await api("obs/" + S.o1 + "/live", { tok: S.RB.tok, body: { on: true } })).s, 404);
  assert.equal((await api("collation?room=" + S.RA.id, { tok: S.B })).s, 403);
  assert.equal(ok(await api("collation", { tok: S.B })).sum.counts.pus, 1);
  assert.equal(ok(await api("pus", { tok: S.RA2.tok })).items.every((x) => x.room_id == S.RA2.id), true);
  const f = await fetch(BASE + "/api/ec8a/" + S.ec + "/file", { headers: { Authorization: "Bearer " + S.RA2.tok } });
  assert.equal(f.status, 404, "other room cannot read EC8A");
  const fb = await fetch(BASE + "/api/ec8a/" + S.ec + "/file", { headers: { Authorization: "Bearer " + S.B } });
  assert.equal(fb.status, 404, "other Command Center cannot read EC8A");
  assert.equal(ok(await api("incidents", { tok: S.B })).length, 0);
  assert.equal((await api("livekit/token", { tok: S.B, body: { code: S.o1 } })).s >= 403, true);
  assert.equal(ok(await api("audit", { tok: S.B })).some((a) => a.who.includes(S.RA.id)), false);
  // messages: a room message to its observer is not visible to / ackable by another room's observer
  ok(await api("messages", { tok: S.RA.tok, body: { to: "obs:" + S.o1, text: "hello o1" } }));
  const m = ok(await api("messages", { tok: S.t1 })).find((x) => x.text == "hello o1");
  assert.ok(m);
  assert.equal((await api("messages/" + m.id + "/ack", { tok: S.t3, body: {} })).s, 404);
  assert.equal((await api("messages/" + m.id + "/ack", { tok: S.t4, body: {} })).s, 404);
  ok(await api("messages/" + m.id + "/ack", { tok: S.t1, body: {} }));
  assert.equal((await api("messages", { tok: S.RA2.tok, body: { to: "obs:" + S.o1, text: "x" } })).s, 403);
});

test("isolation enforced inside PostgreSQL (row-level security)", async () => {
  const c = new Client({ connectionString: DB });
  await c.connect();
  const [{ tenant: tb }] = (await c.query("select tenant from rooms where id=$1", [S.RB.id])).rows;
  await c.query("begin; set local role collation_app; select set_config('app.tenant',$1,true)", [tb]).catch(async () => {
    await c.query("begin; set local role collation_app");
    await c.query("select set_config('app.tenant',$1,true)", [tb]);
  });
  const n = (await c.query("select count(*)::int n from observers")).rows[0].n;
  const t = (await c.query("select count(*)::int n from tallies")).rows[0].n;
  const r = (await c.query("select count(*)::int n from rooms")).rows[0].n;
  assert.equal(n, 1, "Kaduna sees only its own observer");
  assert.equal(t, 0);
  assert.equal(r, 1);
  await assert.rejects(c.query("insert into rooms(id,name,tenant) values('SR-X','x','CC-MAIN')"), /row-level security/);
  await c.query("rollback");
  await c.query("begin; set local role collation_app");
  await c.query("select set_config('app.tenant','CC-MAIN',true), set_config('app.room',$1,true)", [S.RA2.id]);
  assert.equal((await c.query("select count(*)::int n from observers")).rows[0].n, 1, "room sees only its own observer");
  await c.query("rollback");
  await c.query("begin; set local role collation_app");
  assert.equal((await c.query("select count(*)::int n from observers")).rows[0].n, 0, "no context = nothing");
  await c.query("rollback");
  await c.end();
});

test("device reset by the room ends the old phone's session", async () => {
  ok(await api("obs/" + S.o2 + "/reset-device", { tok: S.RA.tok, body: {} }));
  assert.equal((await api("me", { tok: S.t2 })).s, 401);
  S.t2 = ok(await obsLogin(S.o2, 9, "5555")).token;
  ok(await api("me", { tok: S.t2 }));
});

test("bulk contacts, scoped per Command Center", async () => {
  const r = ok(await api("contacts/bulk", { tok: S.RA.tok, body: { rows: [
    { name: "DPO Dala", phone: "+234 803 000 0001", role: "security", lga: "Dala" },
    { name: "Ward sup", phone: "0803-000-0002", role: "Supervisor", level: "ward", ward: "Gwammaja" },
    { name: "", phone: "1" },
  ] } }));
  assert.deepEqual([r.added, r.rejected], [2, 1]);
  const l = ok(await api("contacts", { tok: S.RA.tok }));
  assert.equal(l.length, 2);
  assert.equal(l.find((x) => x.name == "DPO Dala").role, "Security");
  assert.equal(ok(await api("contacts", { tok: S.B })).length, 0);
  assert.equal(ok(await api("contacts", { tok: S.RA2.tok })).length, 0);
});

test("two-step login (TOTP) for Command operators", async () => {
  assert.equal(ok(await api("totp", { tok: S.B })).on, false);
  const s = ok(await api("totp/setup", { tok: S.B, body: {} }));
  assert.match(s.uri, /^otpauth:\/\/totp\//);
  assert.equal((await api("totp/enable", { tok: S.B, body: { code: "000000" } })).s, 400);
  ok(await api("totp/enable", { tok: S.B, body: { code: TOTP.code(s.secret, Math.floor(Date.now() / 30000)) } }));
  assert.equal(ok(await api("totp", { tok: S.B })).on, true);
  const r = await api("login/command", { body: { user: "kdop", pass: "kadunapass1" } });
  assert.equal(r.s, 401);
  assert.equal(r.j.otp, true);
  ok(await api("login/command", { body: { user: "kdop", pass: "kadunapass1", otp: TOTP.code(s.secret, Math.floor(Date.now() / 30000)) } }));
});

test("live video request, heartbeat, disabling a Command Center", async () => {
  ok(await api("obs/" + S.o1 + "/live", { tok: S.RA.tok, body: { on: true } }));
  assert.equal(ok(await api("observer/heartbeat", { tok: S.t1, body: { lat: 12.0, lng: 8.5, streaming: false } })).live, true);
  const o = ok(await api("obs", { tok: S.RA.tok })).find((x) => x.code == S.o1);
  assert.equal(o.lat, 12.0);
  assert.equal(o.live_req, true);
  const tid = ok(await api("tenants", { tok: S.A })).find((t) => t.name == "Kaduna").id;
  ok(await api("tenants/" + tid + "/toggle", { tok: S.A, body: {} }));
  assert.equal((await api("obs", { tok: S.B })).s, 401);
  assert.equal((await api("me", { tok: S.t4 })).s, 401);
});

test("database backup on this PC (platform administrator only)", async () => {
  const b = ok(await api("backups", { tok: S.A, body: {} }));
  assert.match(b.name, /^collation_.*\.dump$/);
  assert.ok(ok(await api("backups", { tok: S.A })).files.some((f) => f.name == b.name && f.size > 1000));
  const r = await fetch(BASE + "/api/backups/" + b.name, { headers: { Authorization: "Bearer " + S.A } });
  assert.equal(r.status, 200);
  assert.equal((await r.arrayBuffer()).byteLength > 1000, true);
  const k = ok(await api("login/command", { body: { user: "admin", pass: "adminpass1" } }));
  assert.ok(k.token);
  assert.equal((await api("backups/../../etc/passwd", { tok: S.A })).s >= 400, true);
});

test("one room per LGA, LGA scope, EC8A voter figures, CORS for the Android app, maps", async () => {
  const c = new Client({ connectionString: DB });
  await c.connect();
  await c.query("insert into locations(state,lga,ward,pu,reg) values ('Kano','Dala','Gwammaja','001',500),('Kano','Fagge','Fagge A','001',500),('Kano','Gwale','Dorayi','001',500)");
  await c.end();
  const r = ok(await api("rooms/bulk", { tok: S.A, body: { state: "Kano", activate: true } }));
  assert.equal(r.created.length, 3);
  assert.equal(ok(await api("rooms/bulk", { tok: S.A, body: { state: "Kano" } })).created.length, 0, "second run skips existing LGAs");
  const dala = r.created.find((x) => x.lga == "Dala");
  const tok = ok(await api("login/room", { body: { id: dala.id, pass: dala.passcode } })).token;
  assert.equal((await api("room/obs", { tok, body: { state: "Kano", lga: "Fagge", ward: "Fagge A", pu: "001" } })).s, 403, "outside its LGA");
  assert.equal((await api("room/obs", { tok, body: { state: "Kaduna", lga: "Dala", ward: "x", pu: "001" } })).s, 403, "outside its state");
  const code = ok(await api("room/obs", { tok, body: { state: "Kano", lga: "Dala", ward: "Gwammaja", pu: "002", reg: 500 } })).code;
  const t = ok(await obsLogin(code, 77)).token;
  assert.equal((await api("observer/sheet", { tok: t, body: { reg: 300, acc: 400 } })).s, 400, "accredited > registered refused");
  ok(await api("observer/sheet", { tok: t, body: { reg: 320, acc: 150 } }));
  ok(await api("observer/tally", { tok: t, body: { party: "APC", v: 160 } }));
  const pu = ok(await api("pus", { tok })).items.find((x) => x.pu == "002");
  assert.deepEqual([pu.reg, pu.acc, pu.anomaly], [320, 150, true], "over-voting vs accredited voters is flagged");
  ok(await api("observer/heartbeat", { tok: t, body: { lat: 12, lng: 8.5, acc: 14.6 } }));
  assert.equal(ok(await api("obs", { tok })).find((o) => o.code == code).acc, 15);
  const pre = await fetch(BASE + "/api/obs", { method: "OPTIONS", headers: { Origin: "https://localhost", "Access-Control-Request-Method": "GET" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://localhost");
  const evil = await fetch(BASE + "/api/health", { headers: { Origin: "https://evil.example" } });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(ok(await api("maps", { tok })), [], "no Google/Mapbox key configured");
});

test("radio: Rdio Scanner / trunk-recorder call upload reaches the room", async () => {
  const key = ok(await api("radio/key", { tok: S.RA.tok, body: {} })).key;
  // trunk-recorder posts multipart/form-data; build one by hand
  const boundary = "----mcc" + Math.random().toString(16).slice(2);
  const parts = [];
  const field = (n, v) => parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`);
  field("key", key); field("talkgroup", "101"); field("talkgroupLabel", "Kano Command"); field("frequency", "154350000"); field("source", "4021"); field("dateTime", String(Math.floor(Date.now() / 1000)));
  const audio = Buffer.from("fake-m4a-bytes-".repeat(50));
  const head = Buffer.from(parts.join("") + `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="call.m4a"\r\nContent-Type: audio/mp4\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const r = await fetch(BASE + "/api/call-upload", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=" + boundary }, body: Buffer.concat([head, audio, tail]) });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /imported/i);
  // bad key is refused in the Rdio Scanner way (plain text)
  const bad = await fetch(BASE + "/api/call-upload", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=" + boundary }, body: Buffer.concat([Buffer.from(parts.join("").replace(key, "GW.SR-XX-NOPE.AAAA") + `--${boundary}--\r\n`)]) });
  assert.equal(bad.status, 401);
  // the call shows up in this room's radio log, with audio, and not in another room
  const log = ok(await api("radio", { tok: S.RA.tok }));
  const call = log.find((x) => x.talkgroup == "101");
  assert.ok(call && call.has_audio && /Kano Command/.test(call.text) && call.freq == "154.3500");
  const other = ok(await api("radio", { tok: S.RA2.tok }));
  assert.equal(other.some((x) => x.talkgroup == "101"), false, "radio stays within the room");
});

test("Command Center carries a state; names flow to room and observer banners", async () => {
  // platform admin creates a state-bound Command Center
  ok(await api("tenants", { tok: S.A, body: { name: "Kaduna State Command", state: "Kaduna", operator: "kdadmin", pass: "kdadminpass1" } }));
  const row = ok(await api("tenants", { tok: S.A })).find((t) => t.name == "Kaduna State Command");
  assert.equal(row.state, "Kaduna");
  const KD = ok(await api("login/command", { body: { user: "kdadmin", pass: "kdadminpass1" } })).token;
  // its config shows the Command Center name as the app name (customizable, defaults to the CC name)
  assert.equal(ok(await api("config", { tok: KD })).appName, "Kaduna State Command");
  assert.equal(ok(await api("me", { tok: KD })).tenantState, "Kaduna");
  // a room created without a state inherits the Command Center's state
  const r = ok(await api("rooms", { tok: KD, body: { name: "Zaria LGA Situation Room" } }));
  ok(await api("rooms/" + r.id + "/status", { tok: KD, body: { status: "active" } }));
  const RT = ok(await api("login/room", { body: { id: r.id, pass: r.passcode } })).token;
  assert.match(r.id, /^SR-KD-/);
  const me = ok(await api("me", { tok: RT }));
  assert.equal(me.room.state, "Kaduna");
  assert.equal(me.cc, "Kaduna State Command");          // Command Center name for the room banner
  assert.equal(me.room.name, "Zaria LGA Situation Room"); // Situation Room name for the banner
  assert.equal(ok(await api("config", { tok: RT })).appName, "Kaduna State Command");
  // rename the room (customizable by the administrator), reflected on its banner
  ok(await api("rooms/" + r.id, { tok: KD, method: "PATCH", body: { name: "Zaria Central SR" } }));
  assert.equal(ok(await api("me", { tok: RT })).room.name, "Zaria Central SR");
  // observer under it gets both the Command Center name and its room name
  const code = ok(await api("room/obs", { tok: RT, body: { state: "Kaduna", lga: "Zaria", ward: "W", pu: "001" } })).code;
  const OT = ok(await obsLogin(code, 88)).token;
  const ome = ok(await api("me", { tok: OT }));
  assert.equal(ome.cc, "Kaduna State Command");
  assert.equal(ome.obs.room_name, "Zaria Central SR");
  // the admin can override the displayed name in App Settings, and it propagates
  ok(await api("settings", { tok: KD, body: { appName: "Kaduna 2027 Command" } }));
  assert.equal(ok(await api("config", { tok: RT })).appName, "Kaduna 2027 Command");
});

test("pitch page serves and open-analytics logs; stats are platform-admin only", async () => {
  // public page
  const pg = await fetch(BASE + "/pitch");
  assert.equal(pg.status, 200);
  assert.match(await pg.text(), /My Situation Room/);
  // log opens with different devices/refs (sendBeacon posts JSON)
  const view = (ref, ua) => fetch(BASE + "/api/pitch/view", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": ua, Referer: "https://wa.me/" }, body: JSON.stringify({ ref, screen: "1080x2400", tz: "Africa/Lagos" }) });
  assert.equal((await view("inec-kano", "Mozilla/5.0 (Linux; Android 13; Infinix) Chrome/120 Mobile Safari/537")).status, 200);
  assert.equal((await view("inec-kano", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605")).status, 200);
  assert.equal((await view("whatsapp-b1", "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537")).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  // platform admin sees the stats
  const st = ok(await api("pitch/stats", { tok: S.A }));
  assert.ok(st.total.views >= 3);
  assert.ok(st.byRef.find((r) => r.k == "inec-kano").n >= 2);
  assert.ok(st.byDevice.find((r) => r.k == "Mobile"));
  assert.ok(st.byDevice.find((r) => r.k == "Desktop"));
  assert.ok(st.byOs.find((r) => r.k == "Android") && st.byOs.find((r) => r.k == "iOS"));
  assert.equal(st.recent[0].ref, "whatsapp-b1");
  // a normal Command Center admin (not the platform administrator) cannot see platform marketing stats
  ok(await api("tenants", { tok: S.A, body: { name: "Mkt Gate Test", operator: "mktgate", pass: "mktgate12" } }));
  const MK = ok(await api("login/command", { body: { user: "mktgate", pass: "mktgate12" } })).token;
  assert.equal((await api("pitch/stats", { tok: MK })).s, 403);
});

test("shared live view: passcode-gated, view-only, scoped, revocable; manuals served in-app", async () => {
  // a fresh Command Center with one active room and two observers
  const inv = ok(await api("tenants", { tok: S.A, body: { name: "Share Test Command" } }));
  const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
  const rm = ok(await api("rooms", { tok: C, body: { name: "Share Room", state: "Kano", scope: "", operator: "op" } }));
  ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
  const R = ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token;
  const mk = async (pu) => ok(await api("room/obs", { tok: R, body: { state: "Kano", lga: "Dala", ward: "W1", pu, reg: 500, name: "o" + pu } })).code;
  const a = await mk("001"), b = await mk("002");
  // an observer from another command cannot be put in a share
  const others = ok(await api("obs", { tok: S.A }));
  if (others.length) assert.equal((await api("shares", { tok: C, body: { codes: [others[0].code] } })).s, 400);
  // share only observer a
  const sh = ok(await api("shares", { tok: R, body: { label: "HQ", codes: [a], talkback: false } }));
  assert.ok(sh.token && sh.passcode && sh.path.endsWith("#" + sh.token));
  assert.equal((await api("share/open", { body: { token: sh.token, pass: "wrong-pass" } })).s, 401);
  assert.equal((await api("share/open", { body: { token: "nope", pass: sh.passcode } })).s, 401);
  const V = ok(await api("share/open", { body: { token: sh.token, pass: sh.passcode } })).token;
  const st = ok(await api("share/state", { tok: V }));
  assert.deepEqual(st.observers.map((o) => o.code), [a]);
  assert.ok(st.pus.every((p) => p.codes.includes(a)) && !JSON.stringify(st).includes(b));
  // the viewer token opens nothing else, and a normal token is not a viewer token
  for (const p of ["obs", "rooms", "me", "shares", "collation", "audit"]) assert.equal((await api(p, { tok: V })).s, 401, p);
  assert.equal((await api("obs/" + a + "/live", { tok: V, body: { on: true } })).s, 401);
  assert.equal((await api("share/state", { tok: R })).s, 401);
  assert.equal((await api("share/watch", { tok: V, body: { code: b } })).s === 200, false);
  // listed for the owner, invisible to another command, and dead once revoked
  assert.equal(ok(await api("shares", { tok: R })).length, 1);
  assert.equal(ok(await api("shares", { tok: S.A })).some((x) => x.token == sh.token), false);
  ok(await api("shares/" + sh.token + "/revoke", { tok: R, body: {} }));
  assert.equal((await api("share/state", { tok: V })).s, 401);
  assert.equal((await api("share/open", { body: { token: sh.token, pass: sh.passcode } })).s, 401);
  // manuals: operator guide for any operator/room, administrator guide for the platform administrator only
  assert.match(ok(await api("help/operator", { tok: R })).html, /<h1/);
  assert.equal((await api("help/admin", { tok: C })).s, 403);
  assert.match(ok(await api("help/admin", { tok: S.A })).html, /<h1/);
});

test("every page and every front-end library the pages load is actually served", async () => {
  // a dependency update that moves a file inside node_modules must fail here, not on election day
  const get = async (p) => (await fetch(BASE + p)).status;
  const pages = ["/", "/pitch", "/help", "/command/", "/room/", "/observer/", "/share/"];
  const seen = new Set();
  for (const p of pages) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p);
    for (const m of (await r.text()).matchAll(/(?:src|href)="(\/(?:vendor|shared)\/[^"]+)"/g)) seen.add(m[1]);
  }
  ["/vendor/jsqr.js", "/vendor/qrcode.js", "/vendor/leaflet/images/marker-icon.png"].forEach((x) => seen.add(x));
  assert.ok(seen.size >= 10);
  for (const u of seen) assert.equal(await get(u), 200, u);
  // the Android build copies these straight out of node_modules
  const sh = fs.readFileSync(path.join(__dirname, "..", "mobile", "build-www.sh"), "utf8");
  for (const m of sh.matchAll(/"\$ROOT\/(node_modules\/[^"*$]+)"/g)) if (!m[1].endsWith(".")) assert.ok(fs.existsSync(path.join(__dirname, "..", m[1])), m[1]);
});

test("state-wide collation pools vote counts across Command Centers of one state, nothing else", async () => {
  const mkCC = async (name) => {
    const inv = ok(await api("tenants", { tok: S.A, body: { name, state: "Jigawa" } }));
    const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
    const rm = ok(await api("rooms", { tok: C, body: { name: name + " room", state: "Lagos", scope: "Dutse" } })); // state is forced to Jigawa
    ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
    const R = ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token;
    const obs = async (pu, votes) => {
      const code = ok(await api("room/obs", { tok: R, body: { state: "Jigawa", lga: "Dutse", ward: "W1", pu, reg: 5000, name: "o" } })).code;
      const t = ok(await api("login/observer", { body: { code, pin: "1234", device: "dev-" + code + "-0123456789abcdef" } })).token;
      ok(await api("observer/tally", { tok: t, body: { party: "APC", v: votes } }));
      return code;
    };
    return { id: inv.id, C, obs };
  };
  const a = await mkCC("Pool A"), b = await mkCC("Pool B");
  await a.obs("001", 100);
  const bCode = await b.obs("002", 50);
  await b.obs("001", 999); // the same unit as A's: must not be added on top of A's own figure
  const own = ok(await api("collation?level=nat", { tok: a.C }));
  assert.equal(own.sum.totals.APC, 100);
  assert.equal(own.pooled, null);
  const st = ok(await api("collation?level=pu&pool=1", { tok: a.C }));
  assert.equal(st.sum.totals.APC, 150, "own PU 001 (100) + external PU 002 (50)");
  assert.deepEqual([st.pooled.centres, st.pooled.extPus, st.pooled.extVotes], [2, 1, 50]);
  assert.ok(!JSON.stringify(st).includes(bCode), "no observer codes cross over");
  // B sees it the other way round: its own 999 for PU 001 stands, plus nothing external (A only has PU 001)
  assert.equal(ok(await api("collation?pool=1", { tok: b.C })).sum.totals.APC, 1049);
  // everything else stays private
  assert.equal(ok(await api("obs", { tok: a.C })).some((o) => o.code == bCode), false);
  assert.equal(ok(await api("pus", { tok: a.C })).items.some((x) => x.pu == "002"), false);
  // the platform administrator can take a Command Center out of the pool
  ok(await api("tenants/" + b.id + "/pool", { tok: S.A, body: { on: false } }));
  await new Promise((r) => setTimeout(r, 2100)); // collation cache
  assert.equal(ok(await api("collation?pool=1", { tok: a.C })).sum.totals.APC, 100);
  assert.equal(ok(await api("collation?pool=1", { tok: b.C })).pooled, null);
});

test("rooms covering the same LGA in different Command Centers collate together (LGA-wide and state-wide)", async () => {
  const mk = async (name, lga, pu, votes) => {
    const inv = ok(await api("tenants", { tok: S.A, body: { name, state: "Yobe" } }));
    const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
    const room = async (lga, pu, votes) => {
      const rm = ok(await api("rooms", { tok: C, body: { name: lga + " room", scope: lga } }));
      ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
      const R = ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token;
      const code = ok(await api("room/obs", { tok: R, body: { state: "Yobe", lga, ward: "W1", pu, reg: 5000, name: "o" } })).code;
      const t = ok(await api("login/observer", { body: { code, pin: "1234", device: "dev-" + code + "-0123456789abcdef" } })).token;
      ok(await api("observer/tally", { tok: t, body: { party: "PDP", v: votes } }));
      return R;
    };
    return { C, room, R: await room(lga, pu, votes) };
  };
  const a = await mk("Yobe A", "Damaturu", "001", 10);
  const b = await mk("Yobe B", "Damaturu", "002", 20); // same LGA, another Command Center
  const a2 = await a.room("Damaturu", "003", 5); // a second room for the same LGA inside Command Center A
  await b.room("Potiskum", "001", 400); // a different LGA of the same state
  // the room's own view, then the whole LGA across rooms and Command Centers (not the other LGA)
  assert.equal(ok(await api("collation", { tok: a.R })).sum.totals.PDP, 10);
  const lga = ok(await api("collation?pool=1", { tok: a.R }));
  assert.equal(lga.sum.totals.PDP, 35, "10 (own) + 5 (sister room) + 20 (other Command Center)");
  assert.deepEqual([lga.pooled.lga, lga.pooled.extPus, lga.pooled.extVotes], ["Damaturu", 2, 25]);
  assert.equal(ok(await api("collation?pool=1", { tok: a2 })).sum.totals.PDP, 35);
  // the Command Center's Global Collation: whole state, and the LGA row adds both centres' rooms
  const st = ok(await api("collation?pool=1&level=lga", { tok: a.C }));
  assert.equal(st.sum.totals.PDP, 435);
  assert.equal(st.rows.find((r) => r.key == "Damaturu").totals.PDP, 35);
  // the room still cannot list the other rooms' observers or polling units
  assert.equal(ok(await api("obs", { tok: a.R })).length, 1);
  assert.equal(ok(await api("pus", { tok: a.R })).count, 1);
});

test("zone rooms: a senator's or rep's room covers only its chosen LGAs; an LGA room covers one", async () => {
  const inv = ok(await api("tenants", { tok: S.A, body: { name: "Zone Test Command", state: "Bauchi" } }));
  const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
  assert.equal((await api("rooms", { tok: C, body: { name: "x", kind: "lga", scope: "Toro,Dass" } })).s, 400, "an LGA room takes one LGA");
  assert.equal((await api("rooms", { tok: C, body: { name: "x", kind: "senate", scope: "" } })).s, 400, "a zone needs LGAs");
  const z = ok(await api("rooms", { tok: C, body: { name: "Bauchi South Senatorial District", kind: "senate", scope: "Toro, Dass ,Toro", operator: "Sen. coordinator" } }));
  ok(await api("rooms/" + z.id + "/status", { tok: C, body: { status: "active" } }));
  const row = ok(await api("rooms", { tok: C })).find((r) => r.id == z.id);
  assert.deepEqual([row.kind, row.scope, row.state], ["senate", "Toro,Dass", "Bauchi"]);
  const R = ok(await api("login/room", { body: { id: z.id, pass: z.passcode } })).token;
  const mk = (lga, pu) => api("room/obs", { tok: R, body: { state: "Bauchi", lga, ward: "W1", pu, reg: 5000, name: "o" } });
  const a = ok(await mk("Toro", "001")).code, b = ok(await mk("Dass", "001")).code;
  assert.equal((await mk("Bauchi", "001")).s, 403, "an LGA outside the zone is refused");
  for (const [code, v] of [[a, 30], [b, 12]]) {
    const t = ok(await api("login/observer", { body: { code, pin: "1234", device: "dev-" + code + "-0123456789abcdef" } })).token;
    ok(await api("observer/tally", { tok: t, body: { party: "LP", v } }));
  }
  // an LGA chairman's room inside the zone, and one outside it
  const lgaRoom = async (lga, v, kind = "lga") => {
    const rm = ok(await api("rooms", { tok: C, body: { kind, name: lga + " room", scope: lga } }));
    ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
    const T = ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token;
    const code = ok(await api("room/obs", { tok: T, body: { state: "Bauchi", lga, ward: "W2", pu: "009", reg: 5000, name: "o" } })).code;
    const t = ok(await api("login/observer", { body: { code, pin: "1234", device: "dev-" + code + "-0123456789abcdef" } })).token;
    ok(await api("observer/tally", { tok: t, body: { party: "LP", v } }));
  };
  await lgaRoom("Dass", 100, "senate"); // another senatorial room covering Dass: the same election, so it adds up
  await lgaRoom("Dass", 5000); // an LGA-chairman room at Dass is a different election: never added in
  await lgaRoom("Katagum", 1000);
  // the zone room: its own observers, then its whole zone (the Dass chairman's room too) - never Katagum
  assert.equal(ok(await api("collation", { tok: R })).sum.totals.LP, 42);
  const zone = ok(await api("collation?pool=1&level=lga", { tok: R }));
  assert.equal(zone.sum.totals.LP, 142);
  assert.deepEqual(zone.rows.map((r) => r.key).sort(), ["Dass", "Toro"]);
});

test("radio receiver control: on/off and tuning from the dashboard, applied by the listening post", async () => {
  const inv = ok(await api("tenants", { tok: S.A, body: { name: "Radio Ctl Test", state: "Kano" } }));
  const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
  const rm = ok(await api("rooms", { tok: C, body: { name: "r", kind: "lga", scope: "Dala" } }));
  ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
  const R = ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token;
  const key = ok(await api("radio/key", { tok: R, body: {} })).key;
  let c = ok(await api("radio/control", { tok: R }));
  assert.deepEqual([c.power, c.freq, c.online], [false, null, false]);
  assert.equal((await api("radio/control", { tok: R, body: { power: true } })).s, 400, "no frequency yet");
  assert.equal((await api("radio/control", { tok: R, body: { freq: 5 } })).s, 400, "out of range");
  assert.equal((await api("radio/control", { tok: R, body: { freq: 154.35, mode: "ssb" } })).s, 400, "unknown mode");
  c = ok(await api("radio/control", { tok: R, body: { freq: 154.35, mode: "fm", squelch: 45, power: true } }));
  assert.deepEqual([c.power, c.freq, c.mode, c.squelch], [true, 154.35, "fm", 45]);
  // the Command Center controls its own room, not other people's
  assert.equal(ok(await api("radio/control?room=" + rm.id, { tok: C })).freq, 154.35);
  assert.ok([403, 404].includes((await api("radio/control", { tok: S.A, body: { room: rm.id, power: false } })).s));
  assert.equal((await api("radio/control?room=" + rm.id, { tok: S.A })).s, 403);
  // the listening post: wrong key refused; right key gets the wanted state and reports its own
  assert.equal((await api("radio/gateway/control", { headers: { "X-Gateway-Key": "GW." + rm.id + ".WRONG" } })).s, 401);
  const w = ok(await api("radio/gateway/control?freq=154.35&running=1", { headers: { "X-Gateway-Key": key } }));
  assert.deepEqual([w.power, w.freq, w.squelch], [true, 154.35, 45]);
  c = ok(await api("radio/control", { tok: R }));
  assert.deepEqual([c.online, c.gw.running, c.gw.freq], [true, true, "154.35"]);
  c = ok(await api("radio/control", { tok: R, body: { power: false } }));
  assert.equal(c.power, false);
  assert.equal(ok(await api("radio/control", { tok: R, body: { presets: [{ name: "Police", freq: 154.2 }, { name: "x", freq: 1 }] } })).presets.length, 1);
});

test("platform administrator: archive / restore / delete Command Centers and rooms; clients cannot; platform-wide collation; broadcast by area", async () => {
  const mk = async (name, state, lga, pu, votes) => {
    const inv = ok(await api("tenants", { tok: S.A, body: { name, state } }));
    const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
    const rm = ok(await api("rooms", { tok: C, body: { name: lga + " room", kind: "lga", scope: lga } }));
    ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
    const R = ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token;
    const code = ok(await api("room/obs", { tok: R, body: { state, lga, ward: "W" + pu, pu, reg: 5000, name: "o" } })).code;
    const t = ok(await api("login/observer", { body: { code, pin: "1234", device: "dev-" + code + "-0123456789abcdef" } })).token;
    ok(await api("observer/tally", { tok: t, body: { party: "ADC", v: votes } }));
    return { id: inv.id, C, R, room: rm.id, code, t };
  };
  const a = await mk("Arch A", "Ekiti", "Ado Ekiti", "001", 11), b = await mk("Arch B", "Osun", "Osogbo", "002", 22);
  // platform-wide collation: every state, vote counts only
  const all = ok(await api("collation?pool=1&level=state", { tok: S.A }));
  assert.ok(all.pooled.all && all.states.includes("Ekiti") && all.states.includes("Osun"));
  assert.deepEqual(["Ekiti", "Osun"].map((s) => all.rows.find((r) => r.key == s)?.totals.ADC), [11, 22]);
  assert.ok(all.scope.some((k) => k.startsWith("Osun|Osogbo|")), "the search lists every state's areas");
  assert.equal(ok(await api("collation?pool=1&state=Osun", { tok: S.A })).sum.totals.ADC, 22);
  const own = ok(await api("collation?pool=1", { tok: a.C }));
  assert.deepEqual([own.pooled.state, own.pooled.all, own.sum.totals.ADC], ["Ekiti", undefined, 11], "a client with a state of its own sees only its own state");
  assert.equal(own.scope, null);
  // broadcast by area: state / LGA / ward, to rooms or to observers
  const bc = (body) => api("broadcast", { tok: a.C, body: { text: "hello", ...body } });
  assert.equal(ok(await bc({ target: "AREA", audience: "rooms", state: "Ekiti" })).ok, 1);
  assert.equal((await bc({ target: "AREA", audience: "rooms", state: "Osun" })).s, 403, "only its own state");
  assert.equal((await bc({ target: "AREA", audience: "rooms", state: "Ekiti", lga: "Nowhere" })).s, 400);
  ok(await bc({ target: "AREA", audience: "obs", state: "Ekiti", lga: "Ado Ekiti", ward: "W001" }));
  assert.equal((await bc({ target: "AREA", audience: "obs", state: "Ekiti", lga: "Ado Ekiti", ward: "W999" })).s, 400, "no observers in that ward");
  const seen = ok(await api("messages", { tok: a.t })).filter((m) => m.text == "hello");
  assert.equal(seen.length, 1, "the observer in the ward gets the area message");
  assert.equal(ok(await api("messages", { tok: b.t })).filter((m) => m.text == "hello").length, 0, "other areas do not");
  assert.equal(ok(await api("broadcasts", { tok: a.C })).find((m) => m.to_scope.startsWith("area:")).targets, 1);
  // clients cannot archive or delete; only the platform administrator
  for (const [p, body] of [["tenants/" + a.id + "/archive", { on: true }], ["tenants/" + a.id + "/delete", { confirm: a.id }], ["admin/rooms/" + a.room + "/archive", { on: true }], ["admin/rooms/" + a.room + "/delete", { confirm: a.room }]]) assert.equal((await api(p, { tok: a.C, body })).s, 403, p);
  assert.equal((await api("admin/rooms?tenant=" + a.id, { tok: a.C })).s, 403);
  // archive a room: hidden from the client and from collation, restorable
  const rooms = ok(await api("admin/rooms?tenant=" + a.id, { tok: S.A }));
  assert.deepEqual([rooms.length, rooms[0].obs], [1, 1]);
  ok(await api("admin/rooms/" + a.room + "/archive", { tok: S.A, body: { on: true } }));
  assert.equal(ok(await api("rooms", { tok: a.C })).length, 0);
  assert.equal(ok(await api("collation", { tok: a.C })).sum.total, 0, "an archived room's observers no longer count");
  assert.equal((await api("admin/rooms/" + a.room + "/delete", { tok: S.A, body: { confirm: "nope" } })).s, 400, "typed confirmation required");
  ok(await api("admin/rooms/" + a.room + "/archive", { tok: S.A, body: { on: false } }));
  assert.equal(ok(await api("rooms", { tok: a.C })).length, 1);
  // clear election data keeps the room
  ok(await api("admin/rooms/" + a.room + "/wipe", { tok: S.A, body: { confirm: a.room } }));
  assert.equal(ok(await api("admin/rooms?tenant=" + a.id, { tok: S.A }))[0].obs, 0);
  // Command Center: must be archived first, typed confirmation, then everything is gone
  assert.equal((await api("tenants/CC-MAIN/archive", { tok: S.A, body: { on: true } })).s, 400, "not your own");
  ok(await api("tenants/" + b.id + "/archive", { tok: S.A, body: { on: true } }));
  assert.equal(ok(await api("tenants", { tok: S.A })).find((t) => t.id == b.id).archived, true);
  assert.equal((await api("login/command", { body: { user: "arch-b", pass: "x" } })).s, 401);
  assert.equal(ok(await api("collation?pool=1&state=Osun", { tok: S.A })).sum.total, 0, "an archived center no longer counts");
  assert.equal((await api("tenants/" + b.id + "/delete", { tok: S.A, body: { confirm: "wrong" } })).s, 400);
  const del = ok(await api("tenants/" + b.id + "/delete", { tok: S.A, body: { confirm: b.id } }));
  assert.equal(ok(await api("tenants", { tok: S.A })).some((t) => t.id == b.id), false);
  assert.equal((await api("login/room", { body: { id: b.room, pass: "x" } })).s, 401);
  assert.deepEqual(ok(await api("admin/rooms?tenant=" + b.id, { tok: S.A })), [], "deleting a Command Center deletes all its Situation Rooms");
  assert.equal((await api("login/observer", { body: { code: b.code, pin: "1234", device: "dev-" + b.code + "-0123456789abcdef" } })).s, 401, "...and every observer under them");
  // nothing is lost: a full copy is kept in the vault, and only the platform administrator can read it
  const vault = ok(await api("admin/vault", { tok: S.A }));
  assert.ok(vault.some((v) => v.name == del.kept));
  const copy = ok(await api("admin/vault/" + del.kept, { tok: S.A }));
  assert.deepEqual([copy.observers.length, copy.tallies[0].v, copy.rooms.length, copy.tenant.id], [1, 22, 1, b.id], "the copy holds the observers, their figures and the rooms");
  assert.equal((await api("admin/vault", { tok: a.C })).s, 403);
  assert.equal((await api("admin/vault/..%2Fserver.js", { tok: S.A })).s, 404);
  // deleting a Situation Room directly (no archive step) deletes its observers and keeps a copy too
  const x = await mk("Del Room C", "Kogi", "Lokoja", "003", 7), x2 = await mk("Del Room D", "Kogi", "Lokoja", "004", 9);
  const r1 = ok(await api("admin/rooms/" + x.room + "/delete", { tok: S.A, body: { confirm: x.room } }));
  assert.ok(r1.kept);
  assert.equal(ok(await api("admin/rooms?tenant=" + x.id, { tok: S.A })).length, 0);
  assert.equal(ok(await api("admin/rooms?tenant=" + x2.id, { tok: S.A })).length, 1, "other rooms are untouched");
  // delete ALL rooms of a Command Center, keeping the center
  ok(await api("tenants/" + x2.id + "/delete-rooms", { tok: S.A, body: { confirm: x2.id } }));
  assert.equal(ok(await api("admin/rooms?tenant=" + x2.id, { tok: S.A })).length, 0);
  assert.equal(ok(await api("tenants", { tok: S.A })).some((t) => t.id == x2.id), true, "the center itself stays");
});

test("a room and a state-locked Command Center only hold their own state (contacts)", async () => {
  const inv = ok(await api("tenants", { tok: S.A, body: { name: "State Lock Contacts", state: "Gombe" } }));
  const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
  const rm = ok(await api("rooms", { tok: C, body: { name: "r", kind: "lga", scope: "Akko" } }));
  ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
  const R = ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token;
  ok(await api("contacts", { tok: R, body: { name: "Room Contact", phone: "08011112222", role: "Emergency", level: "LGA", state: "Lagos" } }));
  ok(await api("contacts", { tok: C, body: { name: "Command Contact", phone: "08033334444", role: "Emergency", level: "State", state: "Kano" } }));
  const list = ok(await api("contacts", { tok: C }));
  assert.ok(list.every((c) => c.state == "Gombe"), JSON.stringify(list.map((c) => c.state)));
  assert.equal((await api("room/obs", { tok: R, body: { state: "Lagos", lga: "Akko", ward: "W", pu: "001", reg: 5, name: "x" } })).s, 403, "a room cannot issue codes outside its state");
});

test("marketing: same device coming back is told apart from a link shared with others", async () => {
  const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36";
  const open = (ref, vid) => fetch(BASE + "/api/pitch/view", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify({ ref, vid, screen: "1080x2400", tz: "Africa/Lagos" }) });
  const A = "aaaaaaaaaaaaaaaa-device-one", B = "bbbbbbbbbbbbbbbb-device-two";
  for (const v of [A, A, A, B]) await open("judge-x", v);
  await open("solo-x", A);
  await open("anon-x", undefined); // no id: falls back to a coarse device signature
  await open("anon-x", undefined);
  const st = ok(await api("pitch/stats?days=1", { tok: S.A }));
  const L = Object.fromEntries(st.links.map((l) => [l.k, l]));
  assert.deepEqual([L["judge-x"].opens, L["judge-x"].devices, L["judge-x"].repeats], [4, 2, 2], "forwarded to a second device");
  assert.deepEqual([L["solo-x"].opens, L["solo-x"].devices, L["solo-x"].repeats], [1, 1, 0]);
  assert.deepEqual([L["anon-x"].opens, L["anon-x"].devices], [2, 1], "same signature, no id");
  const rec = st.recent.filter((r) => r.ref == "judge-x").sort((a, b) => a.id - b.id);
  assert.deepEqual(rec.map((r) => r.nth), [1, 2, 3, 1]);
  assert.deepEqual(rec.map((r) => r.devno), [1, 1, 1, 2]);
  assert.ok(st.total.devices >= 3 && st.total.repeats >= 3);
  assert.equal((await api("pitch/view", { body: { ref: "x", vid: "short" } })).s, 200, "a malformed id is ignored, not rejected");
});

test("elections: Governor / Presidential rooms cover the whole state; contests are never mixed or reconciled together", async () => {
  const inv = ok(await api("tenants", { tok: S.A, body: { name: "Contest Test", state: "Taraba" } }));
  const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
  const mkRoom = async (kind, scope) => {
    const rm = ok(await api("rooms", { tok: C, body: { name: kind + " room", kind, scope } }));
    ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
    return { id: rm.id, R: ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token };
  };
  const gov = await mkRoom("governor", "Jalingo, Wukari"), pres = await mkRoom("president", "");
  const rooms = ok(await api("rooms", { tok: C }));
  assert.deepEqual(rooms.map((r) => [r.kind, r.scope]).sort(), [["governor", ""], ["president", ""]], "whole-state contests ignore any LGAs sent");
  assert.equal((await api("rooms", { tok: C, body: { name: "x", kind: "dictator" } })).s, 400, "an unknown election type is refused");
  // an observer of each contest at the SAME polling unit, reporting different figures
  const obs = async (room, v) => {
    const code = ok(await api("room/obs", { tok: room.R, body: { state: "Taraba", lga: "Jalingo", ward: "W1", pu: "001", reg: 5000, name: "o" } })).code;
    const t = ok(await api("login/observer", { body: { code, pin: "1234", device: "dev-" + code + "-0123456789abcdef" } })).token;
    ok(await api("observer/tally", { tok: t, body: { party: "APC", v } }));
  };
  await obs(gov, 100);
  await obs(pres, 700);
  const all = ok(await api("pus", { tok: C }));
  assert.equal(all.count, 2, "one entry per contest at the same unit");
  assert.ok(all.items.every((x) => x.status == "single"), "different contests are not reconciled against each other (no false dispute)");
  assert.deepEqual(all.items.map((x) => x.contest).sort(), ["governor", "president"]);
  const g = ok(await api("collation?contest=governor", { tok: C })), p = ok(await api("collation?contest=president", { tok: C }));
  assert.deepEqual([g.sum.totals.APC, p.sum.totals.APC], [100, 700]);
  assert.deepEqual(ok(await api("collation", { tok: C })).contests.sort(), ["governor", "president"]);
  // a room's whole-state view only adds its own kind of election
  assert.equal(ok(await api("collation?pool=1", { tok: gov.R })).sum.totals.APC, 100);
  assert.equal(ok(await api("collation?pool=1", { tok: pres.R })).sum.totals.APC, 700);
});

test("bulk observer codes: several LGAs / wards / polling units at once, names added later", async () => {
  const c = new Client({ connectionString: DB });
  await c.connect();
  // a small polling-unit list for two LGAs of Plateau
  for (const [lga, ward, pu, reg, name] of [["Jos North", "Ward 1", "001", 600, "Market"], ["Jos North", "Ward 1", "002", 650, "School"], ["Jos North", "Ward 2", "001", 700, "Clinic"], ["Jos South", "Ward 9", "001", 800, "Hall"], ["Bokkos", "Ward 5", "001", 900, "Not in this room"]])
    await c.query("insert into locations(state,lga,ward,pu,reg,name) values('Plateau',$1,$2,$3,$4,$5)", [lga, ward, pu, reg, name]);
  await c.end();
  const inv = ok(await api("tenants", { tok: S.A, body: { name: "Bulk Obs Test", state: "Plateau" } }));
  const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
  const rm = ok(await api("rooms", { tok: C, body: { name: "Jos zone", kind: "reps", scope: "Jos North,Jos South" } }));
  ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
  const R = ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token;
  const units = ok(await api("locations/units?state=Plateau&lgas=Jos North,Jos South", { tok: R }));
  assert.equal(units.length, 4, "one call returns every polling unit of the chosen LGAs");
  const pick = units.map(({ lga, ward, pu }) => ({ lga, ward, pu }));
  const r1 = ok(await api("room/obs/bulk", { tok: R, body: { per: 2, units: pick } }));
  assert.equal(r1.created.length, 8, "4 polling units x 2 observers");
  assert.equal(new Set(r1.created.map((x) => x.code)).size, 8, "codes are unique");
  assert.deepEqual(r1.created.filter((x) => x.pu == "002").map((x) => x.reg), [650, 650], "registered voters come from the unit list");
  assert.equal(ok(await api("obs", { tok: R })).length, 8);
  // asking again tops up only what is missing
  const r2 = ok(await api("room/obs/bulk", { tok: R, body: { per: 3, units: pick.slice(0, 2) } }));
  assert.equal(r2.created.length, 2, "2 units x (3 wanted - 2 already there)");
  const r3 = ok(await api("room/obs/bulk", { tok: R, body: { per: 2, units: pick } }));
  assert.deepEqual([r3.created.length, r3.skipped], [0, 4], "nothing to add when they all have enough");
  // only this room's LGAs, only real polling units
  assert.equal((await api("room/obs/bulk", { tok: R, body: { per: 2, units: [{ lga: "Bokkos", ward: "Ward 5", pu: "001" }] } })).s, 403);
  assert.equal((await api("room/obs/bulk", { tok: R, body: { per: 2, units: [{ lga: "Jos North", ward: "Ward 1", pu: "999" }] } })).s, 400);
  assert.equal((await api("room/obs/bulk", { tok: R, body: { per: 2, units: [] } })).s, 400);
  // names can be added one by one afterwards, by the room or its Command Center, and not by anyone else
  const code = r1.created[0].code;
  ok(await api("obs/" + code + "/name", { tok: R, body: { name: "Musa Bello" } }));
  assert.equal(ok(await api("obs", { tok: C })).find((o) => o.code == code).name, "Musa Bello");
  assert.ok([403, 404].includes((await api("obs/" + code + "/name", { tok: S.A, body: { name: "x" } })).s));
  // the codes work: an observer signs in with one
  assert.ok(ok(await api("login/observer", { body: { code, pin: "1234", device: "dev-" + code + "-0123456789abcdef" } })).token);
});

test("archived and stored data can be found and reviewed (administrator only)", async () => {
  const inv = ok(await api("tenants", { tok: S.A, body: { name: "Review Me", state: "Nasarawa" } }));
  const C = ok(await api("login/command", { body: { user: inv.operator, pass: inv.passcode } })).token;
  const rm = ok(await api("rooms", { tok: C, body: { name: "Keffi", kind: "lga", scope: "Keffi" } }));
  ok(await api("rooms/" + rm.id + "/status", { tok: C, body: { status: "active" } }));
  const R = ok(await api("login/room", { body: { id: rm.id, pass: rm.passcode } })).token;
  const sub = async (pu, party, v) => {
    const code = ok(await api("room/obs", { tok: R, body: { state: "Nasarawa", lga: "Keffi", ward: "W1", pu, reg: 5000, name: "o" + pu } })).code;
    const t = ok(await api("login/observer", { body: { code, pin: "1234", device: "dev-" + code + "-0123456789abcdef" } })).token;
    ok(await api("observer/tally", { tok: t, body: { party, v } }));
  };
  await sub("001", "APC", 120);
  await sub("002", "PDP", 45);
  // a Command Center cannot see the archive or review anything
  for (const p of ["admin/archive", "admin/review?tenant=" + inv.id, "admin/vault/x.json/review"]) assert.equal((await api(p, { tok: C })).s, 403, p);
  // archive the room, then the center: both are listed, and reviewable although hidden everywhere else
  ok(await api("admin/rooms/" + rm.id + "/archive", { tok: S.A, body: { on: true } }));
  let arch = ok(await api("admin/archive", { tok: S.A }));
  assert.ok(arch.rooms.some((r) => r.id == rm.id && r.tenant_name == "Review Me" && r.obs == 2));
  const rr = ok(await api("admin/review?room=" + rm.id, { tok: S.A }));
  assert.deepEqual([rr.totals.APC, rr.totals.PDP, rr.counts.observers, rr.counts.units], [120, 45, 2, 2], "an archived room's results are reviewable");
  assert.equal(ok(await api("collation", { tok: C })).sum.total, 0, "...but hidden from the client's collation");
  ok(await api("admin/rooms/" + rm.id + "/archive", { tok: S.A, body: { on: false } }));
  ok(await api("tenants/" + inv.id + "/archive", { tok: S.A, body: { on: true } }));
  arch = ok(await api("admin/archive", { tok: S.A }));
  assert.ok(arch.centers.some((t) => t.id == inv.id && t.rooms == 1 && t.observers == 2));
  const tr = ok(await api("admin/review?tenant=" + inv.id, { tok: S.A }));
  assert.deepEqual([tr.totals.APC, tr.totals.PDP, tr.title.includes("Review Me")], [120, 45, true]);
  assert.ok(tr.observers.every((o) => o.t && Object.keys(o.t).length) && tr.units.length == 2);
  // delete it: the stored copy can still be reviewed, with the same figures
  const del = ok(await api("tenants/" + inv.id + "/delete", { tok: S.A, body: { confirm: inv.id } }));
  assert.equal(ok(await api("admin/archive", { tok: S.A })).centers.some((t) => t.id == inv.id), false);
  const vr = ok(await api("admin/vault/" + del.kept + "/review", { tok: S.A }));
  assert.deepEqual([vr.totals.APC, vr.totals.PDP, vr.counts.observers, vr.counts.units, vr.source], [120, 45, 2, 2, "vault"]);
  assert.ok(ok(await api("admin/archive", { tok: S.A })).vault.some((v) => v.name == del.kept));
  assert.equal((await api("admin/vault/..%2F..%2Fetc%2Fpasswd/review", { tok: S.A })).s, 404);
});
