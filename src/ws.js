const {LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus} = require("./core");
const { WebSocketServer } = require("ws");
const server =
  E.HTTPS_KEY && E.HTTPS_CERT && fs.existsSync(E.HTTPS_KEY)
    ? https.createServer({ key: fs.readFileSync(E.HTTPS_KEY), cert: fs.readFileSync(E.HTTPS_CERT) }, app)
    : http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
bus.notify = notify;
function notify(tn) {
  wss.clients.forEach(
    (c) => c.readyState == 1 && (!tn || !c.tn || c.tn == tn) && c.send('{"type":"changed"}'),
  );
}
wss.on("connection", (ws, req) => {
  let u;
  try {
    u = jwt.verify(new URL(req.url, "http://x").searchParams.get("t"), SECRET);
  } catch {
    return ws.close();
  }
  ws.u = u;
  ws.id = crypto.randomUUID();
  tnOf(u)
    .then((t) => (ws.tn = t))
    .catch(() => {});
  ws.allowed = new Set();
  ws.send(JSON.stringify({ type: "hello", id: ws.id }));
  if (u.role == "obs")
    q("update observers set seen=now() where code=$1", [u.id])
      .then(() => notify())
      .catch(() => {});
  ws.on("close", () => {
    if (u.role == "obs")
      q("update observers set seen=now()-interval '1 hour',streaming=false where code=$1", [u.id])
        .then(() => notify())
        .catch(() => {});
  });
  ws.on("message", async (raw) => {
    try {
      const m = JSON.parse(raw),
        find = (f) => [...wss.clients].find((c) => c.readyState == 1 && f(c));
      if (u.role != "obs") {
        if (!m.code) return;
        if (!ws.allowed.has(m.code)) {
          const [o] = await q(
            "select o.room_id,r.tenant from observers o join rooms r on r.id=o.room_id where o.code=$1",
            [m.code],
          );
          if (!o || !(u.role == "cmd" ? o.tenant == ws.tn : o.room_id == u.id)) return;
          ws.allowed.add(m.code);
        }
        const t = find((c) => c.u.role == "obs" && c.u.id == m.code);
        if (!t) return ws.send(JSON.stringify({ type: "nostream", code: m.code }));
        t.send(JSON.stringify({ ...m, from: ws.id }));
      } else {
        const t = find((c) => c.id == m.to && c.allowed.has(u.id));
        if (t) t.send(JSON.stringify({ ...m, code: u.id }));
      }
    } catch (e) {}
  });
});
module.exports = { server, wss };
