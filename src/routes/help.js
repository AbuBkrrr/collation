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
// Public help page (linked from the landing page): the operator manual, readable without signing in.
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/vendor/fa/css/all.min.css"><link rel="stylesheet" href="/shared/fonts.css"><link rel="stylesheet" href="/shared/style.css"><style>body{background:#eef2f6;padding:18px;display:block}.hp{max-width:960px;width:100%;min-width:0;box-sizing:border-box;margin:0 auto;overflow:hidden;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:26px}.hb{display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;align-items:center;margin-bottom:10px}@media(max-width:640px){body{padding:0}.hp{border-radius:0;padding:16px}}</style></head><body><div class="hp"><div class="hb"><a class="btn btn-outline" href="/"><i class="fas fa-arrow-left"></i> Home</a><a class="btn btn-primary" href="/help/manual.pdf"><i class="fas fa-file-pdf"></i> Download PDF</a></div><div class="manual">${body}</div></div></body></html>`;
app.get("/help", (req, res) => res.type("html").send(page(GUIDES.operator.title, marked.parse(fs.readFileSync(path.join(DOCS, GUIDES.operator.file), "utf8")))));
app.get("/help/manual.pdf", (req, res) => {
  const f = path.join(DOCS, "pdf", GUIDES.operator.pdf);
  fs.existsSync(f) ? res.download(f, GUIDES.operator.pdf) : res.sendStatus(404);
});
module.exports = { GUIDES };
