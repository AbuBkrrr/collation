// Smoke test: every page and every tab of the Command Center, Situation Room, Observer and the four Collation Officer
// levels, at phone / tablet / desktop widths. Fails on any script error, failed request or sideways scroll.
//   SMOKE_DATABASE_URL=postgres://postgres@localhost:5432/collation_smoke node test/smoke.js   (needs Playwright)
const { spawn, execSync } = require("child_process"), { chromium } = require("playwright"), { Client } = require("pg");
(async () => {
  const U = process.env.SMOKE_DATABASE_URL || "postgres://postgres@127.0.0.1:5432/collation_smoke", P = 7811, B = "http://127.0.0.1:" + P, env = { ...process.env, DATABASE_URL: U, PORT: P, COMMAND_PASSCODE: "adminpass1", JWT_SECRET: "x", DATA_DIR: require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "smoke-")), REQUIRE_OFFICERS: "0", SEED_LOCATIONS: "0", BACKUP_MINS: "0" };
  const a = new Client({ connectionString: (() => { const u = new URL(U); u.pathname = "/postgres"; return u.href; })() }); await a.connect();
  await a.query("drop database if exists collation_smoke"); await a.query("create database collation_smoke"); await a.end();
  const srv = spawn("node", ["server.js"], { cwd: require("path").join(__dirname, ".."), env, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + "/api/health")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  await new Promise((r) => setTimeout(r, 1500));
  execSync("node scripts/seed-demo.js", { cwd: require("path").join(__dirname, ".."), env, stdio: "ignore" });
  const api = async (p, body, tok) => { const r = await fetch(B + "/api/" + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body && JSON.stringify(body) }); return r.json(); };
  const demo = (await api("login/command", { user: "demo", pass: "demo1234" })).token, adm = (await api("login/command", { user: "admin", pass: "adminpass1" })).token;
  const rooms = await api("rooms", null, demo), room = rooms.find((r) => r.status == "active") || rooms[0];
  const rp = (await api("rooms/" + room.id + "/reset", {}, demo)).passcode, rtok = (await api("login/room", { id: room.id, pass: rp })).token;
  const obs = await api("obs", null, rtok), o = obs[0];
  const otok = (await api("login/observer", { code: o.code, pin: "1234", device: "scan-device-0123456789abcdef" })).token;
  const offs = {};
  for (const [lv, b] of Object.entries({ ward: { ward: o.ward, lga: o.lga }, lga: { lga: o.lga }, state: {}, })) { const r = await api("officers", { level: lv, name: lv + " officer", ...b }, demo); offs[lv] = (await api("login/officer", { code: r.code, pass: r.passcode })).token; }
  const fed = await api("tenants", { name: "Fed", officer: { name: "Fed Off" } }, adm); offs.federal = (await api("login/officer", { code: fed.officer.code, pass: fed.officer.passcode })).token;
  const br = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const VP = { phone: { width: 375, height: 740 }, tablet: { width: 820, height: 1100 }, desktop: { width: 1366, height: 820 } }, issues = [];
  for (const [vn, vp] of Object.entries(VP)) {
    const ctx = await br.newContext({ viewport: vp });
    const run = async (name, url, tok, tabs) => {
      const pg = await ctx.newPage(), errs = [];
      pg.on("console", (m) => m.type() == "error" && !/favicon|tile|arcgis|openstreetmap|ERR_|example\.test|Failed to load resource.*(40[34])/i.test(m.text()) && errs.push("console: " + m.text().slice(0, 150)));
      pg.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 150)));
      pg.on("response", (r) => { const u = r.url(); if (r.status() >= 400 && u.startsWith(B) && !/favicon/.test(u)) errs.push("http " + r.status() + " " + u.replace(B, "")); });
      if (tok) await pg.addInitScript((t) => sessionStorage.setItem("t", t), tok);
      await pg.goto(B + url, { waitUntil: "domcontentloaded" }); await pg.waitForTimeout(1500);
      const chk = async (l) => { const r = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth })); if (r.sw > r.w + 2) errs.push(`sideways scroll at ${l} (${r.sw}>${r.w})`); };
      await chk("load");
      if (tabs) { const n = await pg.locator(".nav-tab").count(); for (let i = 0; i < n; i++) { const t = pg.locator(".nav-tab").nth(i), l = (await t.innerText()).trim(); await t.click(); await pg.waitForTimeout(700); await chk(l); } }
      errs.forEach((e) => issues.push(`[${vn}] ${name}: ${e}`)); await pg.close();
    };
    for (const [n, u] of [["landing", "/"], ["pitch", "/pitch"], ["help", "/help"], ["command-login", "/command/"], ["room-login", "/room/"], ["observer-login", "/observer/"], ["officer-login", "/officer/"]]) await run(n, u);
    await run("cmd-demo", "/command/", demo, 1); await run("cmd-admin", "/command/", adm, 1); await run("room", "/room/", rtok, 1); await run("observer", "/observer/", otok);
    for (const [lv, t] of Object.entries(offs)) await run("officer-" + lv, "/officer/", t);
    await ctx.close();
  }
  await br.close(); srv.kill(); console.log(issues.length ? issues.join("\n") : "NO ISSUES"); process.exit(issues.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
