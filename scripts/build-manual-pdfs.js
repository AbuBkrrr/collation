// Renders docs/*.md to print-ready PDFs in docs/pdf (served by the in-app Help tab, and for onboarding emails).
//   node scripts/build-manual-pdfs.js        (needs Playwright's Chromium; not needed at runtime)
const fs = require("fs"),
  path = require("path"),
  { marked } = require("marked"),
  { chromium } = require("playwright");
const DOCS = path.join(__dirname, "..", "docs");
const GUIDES = [
  ["OPERATOR-GUIDE.md", "My-Situation-Room-Operator-Manual.pdf", "Command Centre Operator Manual"],
  ["ADMIN-GUIDE.md", "My-Situation-Room-Administrator-Manual.pdf", "Platform Administrator Manual"],
];
const css = `@page{size:A4;margin:18mm 16mm 18mm}body{font-family:Inter,"Segoe UI",Helvetica,Arial,sans-serif;font-size:10.5pt;line-height:1.55;color:#1f2937}
.cover{height:245mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}.cover .k{color:#2b6cb0;font-weight:700;letter-spacing:.14em;font-size:10pt;text-transform:uppercase}.cover h1{font-size:30pt;color:#1a365d;margin:10px 0 8px;border:0}.cover p{color:#4a5568;font-size:12pt}.cover .f{margin-top:60mm;color:#718096;font-size:9.5pt}
h1{font-size:20pt;color:#1a365d;margin:0 0 10px}h2{font-size:14pt;color:#1a365d;margin:22px 0 8px;padding-top:10px;border-top:1px solid #e2e8f0;break-after:avoid}h3{font-size:11.5pt;color:#2b6cb0;margin:14px 0 6px;break-after:avoid}
p,ul,ol{margin:0 0 9px}ul,ol{padding-left:20px}li{margin:3px 0}code{font-family:"JetBrains Mono",Consolas,monospace;background:#edf2f7;padding:1px 5px;border-radius:4px;font-size:9pt}
pre{background:#f7fafc;border:1px solid #e2e8f0;padding:9px 11px;border-radius:8px;white-space:pre-wrap;break-inside:avoid}pre code{background:none;padding:0}
blockquote{border-left:4px solid #d69e2e;background:#fffaf0;padding:8px 12px;margin:0 0 10px;border-radius:0 6px 6px 0;break-inside:avoid}blockquote p{margin:0}
table{border-collapse:collapse;width:100%;margin:0 0 12px;break-inside:avoid}th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;font-size:9.5pt;vertical-align:top}th{background:#f7fafc}hr{display:none}`;
(async () => {
  fs.mkdirSync(path.join(DOCS, "pdf"), { recursive: true });
  const b = await chromium.launch();
  for (const [md, pdf, title] of GUIDES) {
    const body = marked.parse(fs.readFileSync(path.join(DOCS, md), "utf8")).replace(/<h1[^>]*>.*?<\/h1>/s, "");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body><div class="cover"><div class="k">My Situation Room</div><h1>${title}</h1><p>Election observation &amp; real-time collation</p><div class="f">An AI Brains Ventures production</div></div>${body}</body></html>`;
    const p = await b.newPage();
    await p.setContent(html, { waitUntil: "load" });
    await p.pdf({ path: path.join(DOCS, "pdf", pdf), format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: `<div style="font-size:8px;color:#718096;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>My Situation Room — ${title}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>` });
    await p.close();
    console.log("wrote docs/pdf/" + pdf);
  }
  await b.close();
})();
