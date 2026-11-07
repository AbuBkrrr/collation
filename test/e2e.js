// Browser smoke test of the three apps (Playwright + Chromium with fake camera/GPS).
//   E2E_DATABASE_URL=postgres://postgres@localhost:5432/collation_e2e node test/e2e.js [screenshot-dir]
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const { Client } = require("pg");
const fs = require("fs"), path = require("path"), os = require("os");
const DB = process.env.E2E_DATABASE_URL || "postgres://postgres@localhost:5432/collation_e2e";
const PORT = 3977, B = "http://127.0.0.1:" + PORT, OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
const errs = [];
const api = async (p, tok, body) => {
  const r = await fetch(B + "/api/" + p, { method: body ? "POST" : "GET", headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(p + ": " + JSON.stringify(j));
  return j;
};
const watch = (pg, name) => {
  pg.on("pageerror", (e) => errs.push(name + " pageerror: " + e.message));
  pg.on("console", (m) => m.type() == "error" && !/tile|basemaps|arcgis|Failed to load resource/.test(m.text()) && errs.push(name + " console: " + m.text()));
};
(async () => {
  const u = new URL(DB), adm = new URL(DB); adm.pathname = "/postgres";
  const c = new Client({ connectionString: adm.href }); await c.connect();
  await c.query(`drop database if exists "${u.pathname.slice(1)}" with (force)`); await c.query(`create database "${u.pathname.slice(1)}"`); await c.end();
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, DATABASE_URL: DB, PORT, COMMAND_PASSCODE: "adminpass1", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "d-")), BACKUP_MINS: "0" }, stdio: "inherit" });
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(B + "/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
    const A = (await api("login/command", 0, { user: "admin", pass: "adminpass1" })).token;
    const room = await api("rooms", A, { name: "Kano Municipal SR", state: "Kano", operator: "Supervisor Musa" });
    await api("rooms/" + room.id + "/status", A, { status: "active" });
    const R = (await api("login/room", 0, { id: room.id, pass: room.passcode })).token;
    const lga = (await api("locations?state=Kano", R))[0].lga, ward = (await api("locations?state=Kano&lga=" + encodeURIComponent(lga), R))[0].ward;
    const pu = (await api(`locations?state=Kano&lga=${encodeURIComponent(lga)}&ward=${encodeURIComponent(ward)}`, R))[0].pu;
    const o1 = (await api("room/obs", R, { state: "Kano", lga, ward, pu, reg: 600, name: "Aisha" })).code;
    const o2 = (await api("room/obs", R, { state: "Kano", lga, ward, pu, reg: 600, name: "Bello" })).code;
    const br = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
    // ---- observer phone 1 (UI) ----
    const ph = await br.newContext({ viewport: { width: 420, height: 900 }, geolocation: { latitude: 12.0, longitude: 8.52 }, permissions: ["geolocation", "camera", "microphone"] });
    const op = await ph.newPage(); watch(op, "observer");
    await op.goto(B + "/observer/");
    op.on("response", (r) => r.url().includes("/api/") && r.status() >= 400 && console.log("HTTP", r.status(), r.url()));
    await op.fill("#lc", o1); await op.fill("#lpin", "2468"); await op.click("button:has-text('Login')");
    await op.waitForSelector("text=VOICE TALLY", { timeout: 15000 }).catch(async (e) => { await op.screenshot({ path: path.join(OUT, "observer-fail.png") }); console.log("ERRS", errs, await op.textContent("#toast"), await op.evaluate(() => sessionStorage.getItem("t"))); throw e; });
    for (const [p, v] of [["APC", "251"], ["PDP", "180"]]) { await op.selectOption("#mp", p); await op.fill("#mv", v); await op.click(".correction-controls button:has-text('+')"); await op.waitForTimeout(700); }
    // a realistic-size "photo" (noise) drawn in the page
    const png = Buffer.from(await op.evaluate(() => { const c = document.createElement("canvas"); c.width = 1200; c.height = 1600; const x = c.getContext("2d"), d = x.createImageData(1200, 1600); for (let i = 0; i < d.data.length; i++) d.data[i] = (i * 7919) % 251; x.putImageData(d, 0, 0); return c.toDataURL("image/png").split(",")[1]; }), "base64");
    await op.setInputFiles("input[type=file]", { name: "ec8a.png", mimeType: "image/png", buffer: png });
    await op.waitForSelector("text=uploaded ✓", { timeout: 10000 });
    await op.click("text=Start Stream"); await op.waitForTimeout(2500);
    await op.screenshot({ path: path.join(OUT, "observer.png") });
    // ---- observer 2 via API (disagrees on PDP) ----
    const T2 = (await api("login/observer", 0, { code: o2, pin: "1357", device: "second-phone-device-0001" })).token;
    await api("observer/tally", T2, { party: "APC", v: 251 }); await api("observer/tally", T2, { party: "PDP", v: 108 });
    await api("observer/heartbeat", T2, { lat: 12.01, lng: 8.53, streaming: false });
    // ---- situation room ----
    const rc = await br.newContext({ viewport: { width: 1440, height: 1000 } });
    const rp = await rc.newPage(); watch(rp, "room");
    await rp.goto(B + "/room/"); await rp.fill("#li", room.id); await rp.fill("#lp", room.passcode); await rp.click("button:has-text('Enter')");
    await rp.waitForSelector("text=Real-Time Collation"); await rp.waitForTimeout(2500);
    await rp.screenshot({ path: path.join(OUT, "room-dashboard.png"), fullPage: true });
    await rp.click(".nav-tab:has-text('Results')"); await rp.waitForSelector("text=Disputed ·", { timeout: 8000 }).catch(() => {});
    await rp.waitForSelector(".incident-item"); await rp.click("button:text-is('Resolve')");
    await rp.click(`text=Use ${o1}`); await rp.fill("#rf_note", "Matches EC8A photo"); await rp.click("text=Save final result");
    await rp.waitForTimeout(1500); await rp.click(".nav-tab:has-text('Results')");
    await rp.click("button:text-is('Resolved')"); await rp.waitForSelector("text=FINAL", { timeout: 8000 });
    await rp.waitForTimeout(700); await rp.screenshot({ path: path.join(OUT, "room-results.png"), fullPage: true });
    await rp.click(".nav-tab:has-text('Observer Manager')"); await rp.waitForTimeout(800);
    await rp.screenshot({ path: path.join(OUT, "room-observers.png"), fullPage: true });
    await rp.click(".nav-tab:has-text('Contacts')");
    await rp.setInputFiles("#cf", { name: "c.csv", mimeType: "text/csv", buffer: Buffer.from("name,phone,role,level,state,lga\nDPO,+2348030000001,Security,LGA,Kano," + lga + "\n") });
    await rp.click("text=Import contacts"); await rp.waitForSelector("text=1 added", { timeout: 8000 });
    // request live from room dashboard
    await rp.click(".nav-tab:has-text('Situation Room Dashboard')"); await rp.click(`.tw td:has-text('${o1}')`).catch(() => {});
    // ---- command center ----
    const cc = await br.newContext({ viewport: { width: 1440, height: 1000 } });
    const cp = await cc.newPage(); watch(cp, "command");
    await cp.goto(B + "/command/"); await cp.fill("#lp", "adminpass1"); await cp.click("button:has-text('Enter')");
    await cp.waitForSelector("text=Situation Rooms ("); await cp.screenshot({ path: path.join(OUT, "command-rooms.png"), fullPage: true });
    // click through EVERY Command Center tab; any pageerror/console error fails the run
    const tabs = await cp.$$eval(".nav-tab", (els) => els.map((e) => e.textContent.trim()));
    for (const t of tabs) {
      await cp.click(`.nav-tab:text-is(${JSON.stringify(t)})`).catch(() => cp.click(`.nav-tab:has-text(${JSON.stringify(t.split(" ").slice(-1)[0])})`));
      await cp.waitForTimeout(900);
      await cp.screenshot({ path: path.join(OUT, "command-" + t.replace(/[^a-z]/gi, "").toLowerCase().slice(0, 12) + ".png"), fullPage: true });
    }
    console.log("command tabs ok: " + tabs.join(", "));
    await cp.click(".nav-tab:has-text('Observers & Map')"); await cp.click(`tr:has-text('${o1}') button:text-is('Live')`); await cp.waitForTimeout(2000);
    const live = await op.evaluate(() => LIVEREQ);
    const coll = await api("collation", A);
    console.log(JSON.stringify({ liveReachedPhone: live, counts: coll.sum.counts, APC: coll.sum.totals.APC, PDP: coll.sum.totals.PDP }));
    await br.close();
    if (errs.length) { console.log("ERRORS:\n" + errs.join("\n")); process.exitCode = 1; }
    if (!live || coll.sum.counts.resolved != 1 || coll.sum.totals.PDP != 180) process.exitCode = 1;
    console.log(process.exitCode ? "E2E FAILED" : "E2E OK", OUT);
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
