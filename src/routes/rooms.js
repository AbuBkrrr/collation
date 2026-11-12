const {bcrypt,STATES,q,rnd,abbr,aud,h,app,auth,mine} = require("../core");
// ---- rooms (Command) ----
app.get(
  "/api/rooms",
  auth("cmd"),
  h(async (req, res) =>
    res.json(
      await q(
        `select r.id,r.name,r.state,r.scope,r.kind,r.operator,r.status,r.activated_at,(r.last_seen>now()-interval '40 seconds') online,(select count(*)::int from observers where room_id=r.id) obs,(select coalesce(sum(pend),0)::int from observers where room_id=r.id) pend from rooms r where r.tenant=$1 and not coalesce(r.archived,false) order by r.id`,
        [req.u.tn],
      ),
    ),
  ),
);
app.post(
  "/api/rooms",
  auth("cmd"),
  h(async (req, res) => {
    const b = req.body;
    // a Command Center that was created for one state only ever makes rooms in that state
    const [t] = await q("select state from tenants where id=$1", [req.u.tn]);
    if (t?.state) b.state = t.state;
    if (!b.name || !STATES.includes(b.state))
      return res.status(400).json({ error: "Name and valid state required" });
    // Who the room is for decides how many LGAs it covers: an LGA chairman has exactly one; a senator
    // (senatorial district), a House of Reps member (federal constituency) or a custom zone has a chosen set.
    const KINDS = ["lga", "governor", "president", "senate", "reps", "zone"],
      kind = KINDS.includes(b.kind) ? b.kind : null,
      badKind = b.kind && !kind,
      whole = kind == "governor" || kind == "president", // a whole-state contest: no LGAs to choose
      lgas = whole ? [] : [...new Set(String(b.scope || "").split(",").map((x) => x.trim()).filter(Boolean))];
    if (badKind) return res.status(400).json({ error: "Unknown election type" });
    if (kind == "lga" && lgas.length != 1) return res.status(400).json({ error: "An LGA room covers exactly one LGA" });
    if (kind && kind != "lga" && !whole && !lgas.length) return res.status(400).json({ error: "Choose the LGAs this zone covers" });
    if (lgas.length) {
      // where the state's LGA list is loaded, every chosen LGA must be one of that state's
      const known = (await q("select distinct lga from locations where state=$1", [b.state])).map((x) => x.lga.toLowerCase());
      const bad = known.length ? lgas.filter((l) => !known.includes(l.toLowerCase())) : [];
      if (bad.length) return res.status(400).json({ error: bad.join(", ") + " is not an LGA of " + b.state });
    }
    {
      const O = require("./officers");
      if (await O.required()) {
        if (lgas.length == 1) {
          if (!String(b.officer?.name || "").trim() && !(await O.hasOfficer(req.u.tn, "lga", b.state, lgas[0])))
            return res.status(400).json({ error: "Name the LGA Collation Officer (Officer 2) for " + lgas[0] + " — a Situation Room needs its supervisor" });
        } else if (!(await O.hasOfficer(req.u.tn, "state", b.state)) && !(await O.hasOfficer(req.u.tn, "federal", null)))
          return res.status(400).json({ error: "Add the State (Officer 3) or Federal (Officer 4) Collation Officer first — open the Collation Officers tab" });
      }
    }
    const id = "SR-" + abbr(b.state) + "-" + rnd(3),
      pass = rnd(10);
    await q("insert into rooms(id,name,state,scope,operator,pass_hash,tenant,kind) values($1,$2,$3,$4,$5,$6,$7,$8)", [
      id,
      String(b.name).slice(0, 80),
      b.state,
      lgas.join(","),
      b.operator || "",
      await bcrypt.hash(pass, 10),
      req.u.tn,
      kind,
    ]);
    aud("CMD", "Created room " + id);
    // optional: name the LGA Collation Officer (2) for a single-LGA room while creating it
    let officer = null;
    const oc = b.officer;
    if (oc && oc.name && lgas.length == 1 && !(await require("./officers").hasOfficer(req.u.tn, "lga", b.state, lgas[0]))) {
      try {
        officer = await require("./officers").mk(req.u.tn, { level: "lga", name: oc.name, phone: oc.phone, lga: lgas[0], state: b.state });
      } catch {}
    }
    res.json({ id, passcode: pass, officer });
  }),
);
app.patch(
  "/api/rooms/:id",
  auth("cmd"),
  h(async (req, res) => {
    if (!(await mine(req.u, req.params.id))) return res.sendStatus(404);
    const b = req.body,
      [t] = await q("select state from tenants where id=$1", [req.u.tn]);
    if (t?.state) b.state = null; // state is fixed by the Command Center
    else if (b.state && !STATES.includes(b.state)) return res.status(400).json({ error: "Unknown state" });
    await q(
      "update rooms set name=coalesce($5,name),state=coalesce($2,state),scope=coalesce($3,scope),operator=coalesce($4,operator) where id=$1",
      [req.params.id, b.state, b.scope, b.operator, b.name ? String(b.name).slice(0, 80) : null],
    );
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/rooms/:id/status",
  auth("cmd"),
  h(async (req, res) => {
    const s = req.body.status;
    if (!["active", "inactive", "suspended"].includes(s)) return res.sendStatus(400);
    if (!(await mine(req.u, req.params.id))) return res.sendStatus(404);
    await q(
      "update rooms set status=$2,activated_at=case when $2='active' then now() else activated_at end where id=$1",
      [req.params.id, s],
    );
    aud("CMD", s + " room " + req.params.id);
    res.json({ ok: 1 });
  }),
);
app.post(
  "/api/rooms/reset-passcodes",
  auth("cmd"),
  h(async (req, res) => {
    const rooms = await q("select id,name,state,scope from rooms where tenant=$1 order by id", [req.u.tn]);
    const out = [];
    for (const r of rooms) {
      const p = rnd(10);
      await q("update rooms set pass_hash=$2 where id=$1", [r.id, await bcrypt.hash(p, 10)]);
      out.push({ id: r.id, name: r.name, lga: r.scope, passcode: p });
    }
    aud("CMD", "Reset and exported passcodes for " + out.length + " rooms");
    res.json({ rooms: out });
  }),
);
app.post(
  "/api/rooms/:id/reset",
  auth("cmd"),
  h(async (req, res) => {
    if (!(await mine(req.u, req.params.id))) return res.sendStatus(404);
    const p = rnd(10);
    await q("update rooms set pass_hash=$2 where id=$1", [req.params.id, await bcrypt.hash(p, 10)]);
    aud("CMD", "Reset passcode " + req.params.id);
    res.json({ passcode: p });
  }),
);
