// Proves the bundled Android web app (mobile/www) works against a remote Command Center server:
// different origin for the app vs the API, exercising CORS, cross-origin fetch and WebSocket.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const { Client } = require("pg");
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const DB = process.env.APPE2E_DATABASE_URL || "postgres://postgres@localhost:5432/collation_appe2e";
const API = 3955, APP = 3956, B = "http://127.0.0.1:" + API;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json" };
const errs = [];
const api = async (p, tok, body) => { const r = await fetch(B + "/api/" + p, { method: body ? "POST" : "GET", headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json" }, body: body && JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(p + " " + JSON.stringify(j)); return j; };
(async () => {
  // static server for mobile/www (the "installed app")
  const root = path.join(__dirname, "..", "mobile", "www");
  if (!fs.existsSync(path.join(root, "app.html"))) { require("child_process").execSync("sh build-www.sh", { cwd: path.join(__dirname, "..", "mobile") }); }
  const appsrv = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(req.url.split("?")[0]));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  }).listen(APP);
  const u = new URL(DB), adm = new URL(DB); adm.pathname = "/postgres";
  const c = new Client({ connectionString: adm.href }); await c.connect();
  await c.query(`drop database if exists "${u.pathname.slice(1)}" with (force)`); await c.query(`create database "${u.pathname.slice(1)}"`); await c.end();
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, DATABASE_URL: DB, PORT: API, COMMAND_PASSCODE: "adminpass1", SEED_LOCATIONS: "0", BACKUP_MINS: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "a-")), CORS_ORIGINS: "http://127.0.0.1:" + APP }, stdio: "ignore" });
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(B + "/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
    const A = (await api("login/command", 0, { user: "admin", pass: "adminpass1" })).token;
    const room = await api("rooms", A, { name: "Kano Municipal", state: "Kano" });
    await api("rooms/" + room.id + "/status", A, { status: "active" });
    const R = (await api("login/room", 0, { id: room.id, pass: room.passcode })).token;
    const code = (await api("room/obs", R, { state: "Kano", lga: "Dala", ward: "Gwammaja", pu: "007", reg: 500 })).code;
    const br = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
    const ph = await br.newContext({ viewport: { width: 420, height: 900 }, geolocation: { latitude: 12.0, longitude: 8.52 }, permissions: ["geolocation", "camera", "microphone"] });
    const pg = await ph.newPage();
    pg.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    pg.on("console", (m) => m.type() == "error" && !/favicon|tile|arcgis|basemaps/.test(m.text()) && errs.push("console: " + m.text()));
    // simulate first-run: set the Command Center address, as the launcher would
    await pg.addInitScript(() => { window.Capacitor = { Plugins: {} }; });
    await pg.addInitScript((b) => localStorage.setItem("mcc_base", b), B);
    await pg.goto("http://127.0.0.1:" + APP + "/app.html");
    await pg.waitForFunction(() => window.MCC_BASE && window.CFG, { timeout: 15000 }).catch(() => {});
    await pg.waitForSelector("#lc", { timeout: 15000 });
    await pg.fill("#lc", code); await pg.fill("#lpin", "2468"); await pg.click("button:has-text('Login')");
    await pg.waitForSelector("text=VOICE TALLY", { timeout: 15000 });
    await pg.selectOption("#mp", "APC"); await pg.fill("#mv", "321"); await pg.click(".correction-controls button:has-text('+')");
    await pg.fill("#er", "500"); await pg.fill("#ea", "410"); await pg.click("button[title='Save EC8A voter figures']");
    await pg.waitForTimeout(1500);
    const coll = await api("collation", A), served = (await api("obs", R))[0];
    console.log(JSON.stringify({ apcCounted: coll.sum.totals.APC, reg: served.ec_reg, acc: served.ec_acc, bound: served.bound }));
    await br.close();
    if (errs.length) { console.log("ERRORS:\n" + errs.join("\n")); process.exitCode = 1; }
    if (coll.sum.totals.APC !== 321 || served.ec_reg !== 500 || served.ec_acc !== 410) process.exitCode = 1;
    console.log(process.exitCode ? "APP E2E FAILED" : "APP E2E OK");
  } finally { srv.kill(); appsrv.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
