const {qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("./src/core");
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
