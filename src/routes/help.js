const {fs,path,app,auth,h} = require("../core");
const { marked } = require("marked");
// ---- In-app manuals: the Markdown guides in docs/ rendered for the Help tab, plus their PDF versions ----
const DOCS = path.join(__dirname, "..", "..", "docs");
const GUIDES = {
  operator: { file: "OPERATOR-GUIDE.md", pdf: "My-Situation-Room-Operator-Manual.pdf", title: "Command Centre Operator Manual" },
  admin: { file: "ADMIN-GUIDE.md", pdf: "My-Situation-Room-Administrator-Manual.pdf", title: "Platform Administrator Manual", su: true },
};
const pick = (req, res) => {
  const g = GUIDES[req.params.name];
  if (!g) return res.sendStatus(404), null;
  // the administrator manual is for the platform administrator only
  if (g.su && !(req.u.role == "cmd" && req.u.su)) return res.sendStatus(403), null;
  return g;
};
app.get(
  "/api/help/:name",
  auth("cmd", "room"),
  h(async (req, res) => {
    const g = pick(req, res);
    if (!g) return;
    res.json({ title: g.title, html: marked.parse(fs.readFileSync(path.join(DOCS, g.file), "utf8")), pdf: fs.existsSync(path.join(DOCS, "pdf", g.pdf)) });
  }),
);
app.get(
  "/api/help/:name/pdf",
  auth("cmd", "room"),
  h(async (req, res) => {
    const g = pick(req, res);
    if (!g) return;
    const f = path.join(DOCS, "pdf", g.pdf);
    if (!fs.existsSync(f)) return res.sendStatus(404);
    res.download(f, g.pdf);
  }),
);
module.exports = { GUIDES };
