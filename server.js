const {RLS,express,bcrypt,https,fs,path,E,PORT,DATA,pool,q,rnd,SCHEMA,app} = require("./src/core");
const { loadLocations, SEED } = require("./src/locations");
for (const r of ["auth", "tenants", "rooms", "observers", "ops", "messages", "contacts", "data", "settings", "media", "radio", "locations", "results", "admin", "pitch", "shares", "help", "archive", "officers"]) require("./src/routes/" + r);
// front-end libraries are served from this PC (no CDN dependency on election day)
const V = { maxAge: "7d", immutable: true };
for (const [u, d] of [
  ["/vendor/leaflet", "leaflet/dist"],
  ["/vendor/fa", "@fortawesome/fontawesome-free"],
  ["/vendor/fonts/inter", "@fontsource/inter"],
  ["/vendor/fonts/jetbrains-mono", "@fontsource/jetbrains-mono"],
])
  app.use(u, express.static(path.join(__dirname, "node_modules", d), V));
for (const [u, f] of [
  ["/vendor/livekit-client.umd.js", "livekit-client/dist/livekit-client.umd.js"],
  ["/vendor/vosk.js", "vosk-browser/dist/vosk.js"],
  ["/vendor/qrcode.js", "qrcode-generator/qrcode.js"],
  ["/vendor/jsqr.js", "jsqr/dist/jsQR.js"],
  ["/vendor/read-excel-file.min.js", "read-excel-file/bundle/read-excel-file.min.js"],
])
  app.get(u, (req, res) => res.sendFile(path.join(__dirname, "node_modules", f), V));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: "5m" }));
// Android APKs. CI (.github/workflows/android.yml) builds them and commits them to apks/ in the repo,
// so a plain `git pull` brings them to the server. You can also drop a file at DATA_DIR/<name>.apk to
// override. Both appear on the landing page with a download button and a QR code when present.
const apkPath = (name) => {
  const a = path.join(DATA, name + ".apk"),
    b = path.join(__dirname, "apks", name + ".apk");
  return fs.existsSync(a) ? a : fs.existsSync(b) ? b : null;
};
app.get("/download/app", (req, res) => {
  const p = apkPath("observer");
  if (!p) return res.status(404).type("text").send("The Observer Android app has not been published yet.");
  res.download(p, "my-situation-room-observer.apk");
});
app.get("/download/room", (req, res) => {
  const p = apkPath("room");
  if (!p) return res.status(404).type("text").send("The Situation Room Android app has not been published yet.");
  res.download(p, "my-situation-room-room.apk");
});
app.get("/download/officer", (req, res) => {
  const p = apkPath("officer");
  if (!p) return res.status(404).type("text").send("The Collation Officer Android app has not been published yet.");
  res.download(p, "my-situation-room-officer.apk");
});
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "landing", "index.html")));
const { server } = require("./src/ws");
(async () => {
  await pool.query(SCHEMA);
  await pool.query(RLS);
  // indexes on the columns every row-level-security policy and list screen filters by (tenant / room)
  await pool.query(`create index if not exists rooms_tn_i on rooms(tenant);
    create index if not exists contacts_tn_i on contacts(tenant,room_id);
    create index if not exists units_room_i on units(room_id);
    create index if not exists cmd_users_tn_i on cmd_users(tenant);
    create index if not exists officers_tn_i on officers(tenant,level);
    create index if not exists inc_code_i on incidents(code);
    create index if not exists obs_dev_i on observers(device_hash) where device_hash is not null`);
  await q("insert into tenants values('CC-MAIN','Main Command Center') on conflict do nothing");
  for (const t of ["rooms", "contacts", "messages", "audit", "cmd_users"])
    await q("update " + t + " set tenant='CC-MAIN' where tenant is null");
  await q(
    "update cmd_users set su=true where id=(select min(id) from cmd_users) and not exists(select 1 from cmd_users where su)",
  );
  const [lc] = await q("select count(*)::int n from locations");
  if (!lc.n && E.SEED_LOCATIONS != "0" && fs.existsSync(SEED)) {
    try {
      console.log(
        "Loaded bundled location dataset:",
        await loadLocations(JSON.parse(fs.readFileSync(SEED, "utf8"))),
      );
    } catch (e) {
      console.log("Location seed failed:", e.message);
    }
  }
  const [cu] = await q("select count(*)::int n from cmd_users");
  if (!cu.n) {
    const [s] = await q("select v from settings where k='cmd'");
    let hh = s?.v;
    if (!hh) {
      const p = E.COMMAND_PASSCODE || rnd(12);
      hh = await bcrypt.hash(p, 10);
      console.log("\n*** COMMAND CENTER LOGIN  operator: admin  passcode (shown once): " + p + " ***\n");
    }
    await q("insert into cmd_users(name,pass_hash,tenant,su) values('admin',$1,'CC-MAIN',true)", [hh]);
  }
  server.listen(PORT, () =>
    console.log((server instanceof https.Server ? "https" : "http") + "://0.0.0.0:" + PORT),
  );
})();
// one bad request or timer must never take the whole election server down; log it and keep serving
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e && e.stack ? e.stack : e));
process.on("uncaughtException", (e) => console.error("uncaught exception:", e && e.stack ? e.stack : e));
// finish in-flight requests and close the database cleanly when the service is stopped or restarted
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  });
