const {LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("./src/core");
const { loadLocations, SEED } = require("./src/locations");
for (const r of ["auth", "tenants", "rooms", "observers", "ops", "messages", "contacts", "data", "settings", "media", "radio", "locations"]) require("./src/routes/" + r);
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("/", (req, res) =>
  res.send(
    '<link rel=stylesheet href=/shared/style.css><body style="padding:40px"><div class=card style="max-width:420px;gap:12px"><h3>My Collation Center</h3><a class="btn btn-primary" href=/command/>Command Center</a><a class="btn btn-primary" href=/room/>Situation Room</a><a class="btn btn-primary" href=/observer/>Observer App</a></div>',
  ),
);
const { server } = require("./src/ws");
(async () => {
  await pool.query(SCHEMA);
  await q("insert into tenants values('CC-MAIN','Main Command Center') on conflict do nothing");
  for (const t of ["rooms", "contacts", "messages", "audit", "cmd_users"])
    await q("update " + t + " set tenant='CC-MAIN' where tenant is null");
  await q(
    "update cmd_users set su=true where id=(select min(id) from cmd_users) and not exists(select 1 from cmd_users where su)",
  );
  const [lc] = await q("select count(*)::int n from locations");
  if (!lc.n && fs.existsSync(SEED)) {
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
