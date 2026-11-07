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
  ok(await api("observer/tally", { tok: S.t1, body: { party: "APC", v: 100 } }));
  ok(await api("observer/tally", { tok: S.t1, body: { party: "PDP", v: 50 } }));
  assert.equal((await api("observer/tally", { tok: S.t1, body: { party: "APC", v: 5 } })).s, 409);
  ok(await api("observer/tally", { tok: S.t2, body: { party: "APC", v: 100 } }));
  let c = ok(await api("collation", { tok: S.RA.tok }));
  assert.equal(c.sum.counts.partial, 1, "no conflict yet, still entering");
  ok(await api("observer/tally", { tok: S.t2, body: { party: "PDP", v: 60 } }));
  c = ok(await api("collation", { tok: S.RA.tok }));
  assert.equal(c.sum.counts.disputed, 1);
  assert.equal(c.sum.totals.APC, 0, "disputed PU not counted");
  ok(await api("observer/tally/edit", { tok: S.t2, body: { party: "PDP", v: 50 } }));
  assert.equal((await api("observer/tally/edit", { tok: S.t2, body: { party: "PDP", v: 51 } })).s, 409, "second edit refused");
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
