// Verifies the LiveKit path in our code without running the media server: when LIVEKIT_* is configured,
// the server mints a room-scoped join token for the right observer, with camera+mic publish for the
// observer and listen+talkback (mic only) for the room/Command, and refuses cross-room/cross-tenant tokens.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { Client } = require("pg");
const path = require("node:path"), fs = require("node:fs"), os = require("node:os");
// own database so it can run alongside api.test.js under `npm test`
const DB = (() => {
  const b = process.env.LK_DATABASE_URL || process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:5432/collation";
  const u = new URL(b); u.pathname = "/" + u.pathname.slice(1).replace(/_lk$/, "") + "_lk"; return u.href;
})();
const PORT = 3940 + Math.floor(Math.random() * 8), BASE = "http://127.0.0.1:" + PORT;
let srv, S = {};
const api = async (p, { tok, body } = {}) => { const r = await fetch(BASE + "/api/" + p, { method: body ? "POST" : "GET", headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json" }, body: body && JSON.stringify(body) }); const ct = r.headers.get("content-type") || ""; return { s: r.status, j: ct.includes("json") ? await r.json() : await r.text() }; };
const ok = (r) => (assert.ok(r.s < 300, JSON.stringify(r)), r.j);
const decode = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());

before(async () => {
  const u = new URL(DB), adm = new URL(DB); adm.pathname = "/postgres";
  const c = new Client({ connectionString: adm.href }); await c.connect();
  await c.query(`drop database if exists "${u.pathname.slice(1)}" with (force)`); await c.query(`create database "${u.pathname.slice(1)}"`); await c.end();
  srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, DATABASE_URL: DB, PORT, COMMAND_PASSCODE: "adminpass1", JWT_SECRET: "lk", SEED_LOCATIONS: "0", BACKUP_MINS: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "lk-")), LIVEKIT_URL: "wss://example.test/lk", LIVEKIT_API_KEY: "APItestkey", LIVEKIT_API_SECRET: "0123456789abcdef0123456789abcdef" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + "/api/health")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  throw new Error("server did not start");
});
after(() => srv && srv.kill());

test("config advertises LiveKit when configured", async () => {
  assert.equal(ok(await api("config")).lk, true);
});

test("tokens are room-scoped with the right publish rights, and isolated", async () => {
  S.A = ok(await api("login/command", { body: { user: "admin", pass: "adminpass1" } })).token;
  ok(await api("tenants", { tok: S.A, body: { name: "Other", operator: "oth", pass: "otherpass1" } }));
  S.B = ok(await api("login/command", { body: { user: "oth", pass: "otherpass1" } })).token;
  const mk = async (tok, st) => { const r = ok(await api("rooms", { tok, body: { name: "R", state: st } })); ok(await api("rooms/" + r.id + "/status", { tok, body: { status: "active" } })); return { id: r.id, tok: ok(await api("login/room", { body: { id: r.id, pass: r.passcode } })).token }; };
  const RA = await mk(S.A, "Kano"), RA2 = await mk(S.A, "Kano"), RB = await mk(S.B, "Kaduna");
  const code = ok(await api("room/obs", { tok: RA.tok, body: { state: "Kano", lga: "Dala", ward: "W", pu: "001" } })).code;
  const otok = ok(await api("login/observer", { body: { code, device: "dev-abcdef0123456789", pin: "1234" } })).token;

  // observer's own token: room obs-<code>, can publish camera + mic
  const o = ok(await api("livekit/token", { tok: otok, body: {} }));
  assert.equal(o.url, "wss://example.test/lk");
  const og = decode(o.token).video;
  assert.equal(og.room, "obs-" + code);
  assert.equal(og.roomJoin, true);
  assert.equal(og.canPublish, true);
  assert.ok((og.canPublishSources || []).includes("camera"), "observer can publish camera");

  // the room watching: same room, mic only (talkback), can subscribe
  const w = ok(await api("livekit/token", { tok: RA.tok, body: { code } }));
  const wg = decode(w.token).video;
  assert.equal(wg.room, "obs-" + code);
  assert.equal(wg.canSubscribe, true);
  assert.deepEqual(wg.canPublishSources, ["microphone"], "room talkback is mic only");

  // Command of the same tenant: allowed
  ok(await api("livekit/token", { tok: S.A, body: { code } }));
  // another room in the same tenant, another room's Command, and another tenant: refused
  assert.equal((await api("livekit/token", { tok: RA2.tok, body: { code } })).s, 403);
  assert.equal((await api("livekit/token", { tok: RB.tok, body: { code } })).s, 403);
  assert.equal((await api("livekit/token", { tok: S.B, body: { code } })).s, 403);
});
