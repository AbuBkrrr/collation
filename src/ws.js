const {jwt,http,https,fs,crypto,E,SECRET,q,app,tnOf,bus} = require("./core");
const { WebSocketServer } = require("ws");
const server =
  E.HTTPS_KEY && E.HTTPS_CERT && fs.existsSync(E.HTTPS_KEY)
    ? https.createServer({ key: fs.readFileSync(E.HTTPS_KEY), cert: fs.readFileSync(E.HTTPS_CERT) }, app)
    : http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
bus.notify = notify;
// "changed" pushes are coalesced: at most one per Command Center every 1.5 s, however many writes happen
const pend = new Map();
function notify(tn) {
  const k = tn || "*";
  if (pend.has(k)) return;
  pend.set(
    k,
    setTimeout(() => {
      pend.delete(k);
      wss.clients.forEach(
        (c) => c.readyState == 1 && (!tn || !c.tn || c.tn == tn) && c.send('{"type":"changed"}'),
      );
    }, 1500),
  );
}
// direct push to matching sockets (e.g. "start live video" to one observer phone); returns how many got it
function push(pred, m) {
  let n = 0;
  const s = JSON.stringify(m);
  wss.clients.forEach((c) => c.readyState == 1 && c.u && pred(c) && (c.send(s), n++));
  return n;
}
wss.on("connection", (ws, req) => {
  let u;
  try {
    u = jwt.verify(new URL(req.url, "http://x").searchParams.get("t"), SECRET);
  } catch {
    return ws.close();
  }
  if (u.role == "obs" && !u.dh) return ws.close();
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
module.exports = { server, wss, push };
