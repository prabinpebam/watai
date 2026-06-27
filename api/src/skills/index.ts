import type { Skill } from '../domain/skill';
import type { SkillPackage } from '../domain/skill';
import { PDF_SKILL } from './pdf';

// Skill playbooks for the code interpreter. Bundled as a TypeScript module so esbuild compiles the
// bodies into dist/index.cjs (it does not bundle .md). Every library referenced below is
// preinstalled in the sandbox (verified) — no `pip install`, no internet.
//
// NOTE: PDF create/extract are intentionally NOT here — the canonical `pdf` skill (folder-based,
// mounted into the sandbox) owns all PDF guidance to avoid duplicate/conflicting instructions.

const wordDocx: Skill = {
  id: 'word-docx',
  name: 'Word documents (.docx)',
  summary: 'Generate an editable, well-structured Word document.',
  keywords: ['word', 'docx', 'doc', 'editable', 'document', 'letter', 'report', 'memo'],
  outputs: ['document'],
  version: 1,
  body: `For an editable Word document use **python-docx** (\`import docx\`).
- \`doc = docx.Document()\`; set base style font (e.g. Calibri 11) via \`doc.styles['Normal']\`.
- Use real heading styles (\`doc.add_heading(text, level=1|2)\`) so the document has an outline.
- Paragraphs via \`doc.add_paragraph\`; tables via \`doc.add_table(rows, cols)\` with \`table.style =
  'Light Grid Accent 1'\`; images via \`doc.add_picture(path, width=Inches(6))\`.
- Set page margins on \`doc.sections[0]\` (e.g. 2.5 cm). Add a header/footer if it's a formal doc.
- Save to \`/mnt/data/<name>.docx\`. Confirm the path in your reply.`,
};

const excelXlsx: Skill = {
  id: 'excel-xlsx',
  name: 'Excel spreadsheets (.xlsx)',
  summary: 'Build a real spreadsheet with formulas, formatting, and charts.',
  keywords: ['excel', 'xlsx', 'spreadsheet', 'workbook', 'sheet', 'formula', 'pivot', 'chart', 'budget', 'table'],
  outputs: ['spreadsheet'],
  version: 1,
  body: `For spreadsheets use **openpyxl** (\`from openpyxl import Workbook\`).
- Put a bold, shaded header row; freeze it with \`ws.freeze_panes = 'A2'\`; set column widths.
- Write **live formulas** as strings (e.g. \`ws['D2'] = '=B2*C2'\`, totals \`'=SUM(D2:D10)'\`) — never
  pre-computed values when the user expects a working sheet.
- Format numbers/currency via \`cell.number_format = '#,##0.00'\` or \`'$#,##0.00'\`.
- Add a chart with \`openpyxl.chart\` (BarChart/LineChart) referencing the data ranges when useful.
- Use multiple worksheets for multi-section data. Save to \`/mnt/data/<name>.xlsx\`.
- For heavy data wrangling, compute with **pandas** then write via \`df.to_excel\` or openpyxl.`,
};

const slidesPptx: Skill = {
  id: 'slides-pptx',
  name: 'PowerPoint decks (.pptx)',
  summary: 'Create a clean slide deck.',
  keywords: ['powerpoint', 'pptx', 'slides', 'slide', 'deck', 'presentation', 'keynote'],
  outputs: ['presentation'],
  version: 1,
  body: `For slide decks use **python-pptx** (\`from pptx import Presentation\`).
- \`prs = Presentation()\`; set \`prs.slide_width/height\` to 16:9 (\`Inches(13.333) x Inches(7.5)\`).
- One idea per slide: a title + 3–5 concise bullets (\`slide.placeholders\`), or a title + one visual.
- Use a consistent title size (~32pt) and body (~18pt); avoid dense paragraphs.
- Add charts/tables/images with the python-pptx shape APIs; embed matplotlib PNGs for plots.
- Save to \`/mnt/data/<name>.pptx\`.`,
};

const dataViz: Skill = {
  id: 'data-viz',
  name: 'Charts & data visualization',
  summary: 'Generate clear charts as PNG (or into a PDF/report).',
  keywords: ['chart', 'graph', 'plot', 'visualize', 'visualization', 'histogram', 'bar chart', 'line chart', 'scatter', 'dashboard', 'figure'],
  outputs: ['image', 'pdf'],
  version: 1,
  body: `For charts use **matplotlib**.
- One clear message per figure. Always set a title, axis labels, and units; add a legend when >1
  series. Use \`fig.tight_layout()\`.
- Save crisp output: \`fig.savefig('/mnt/data/<name>.png', dpi=200, bbox_inches='tight')\`. For a
  multi-figure report, save a PDF with \`matplotlib.backends.backend_pdf.PdfPages\`.
- Prefer readable defaults; don't over-style. For tabular input, load with **pandas** first.`,
};

const tabularClean: Skill = {
  id: 'tabular-clean',
  name: 'Clean & transform tabular data',
  summary: 'Tidy messy CSV/Excel data with pandas.',
  keywords: ['csv', 'clean', 'transform', 'pandas', 'dataframe', 'dedupe', 'merge', 'pivot', 'aggregate', 'data', 'rows', 'columns'],
  outputs: ['spreadsheet', 'data'],
  version: 1,
  body: `For tabular work use **pandas**.
- Load with \`pd.read_csv\`/\`pd.read_excel\` from \`/mnt/data/\`. Inspect \`df.head()\`, \`df.dtypes\`.
- Clean: strip/normalize column names, parse dates, coerce numerics (\`pd.to_numeric(errors='coerce')\`),
  drop/flag duplicates, handle missing values explicitly (don't silently drop rows the user needs).
- Transform: \`groupby\`/\`agg\`, \`pivot_table\`, \`merge\`. Show the shape before/after.
- Export the result to \`/mnt/data/\` as \`.xlsx\` (with the excel-xlsx skill) or \`.csv\` as requested.`,
};

export const SKILLS: Skill[] = [
  wordDocx,
  excelXlsx,
  slidesPptx,
  dataViz,
  tabularClean,
];

// ---------------------------------------------------------------------------
// Canonical Agent Skills (folder skills mounted into the code-interpreter
// sandbox). Default packages ship with the app; users can add their own.
// ---------------------------------------------------------------------------

/** The default, service-provided canonical skills (on by default, toggle-off). */
export const DEFAULT_SKILLS: SkillPackage[] = [PDF_SKILL];

/** The mounted bootstrap the model runs once to unpack mounted skill zips into
 *  /mnt/data/skills/<name>/. Kept tiny + deterministic + idempotent. */
export const SKILLS_SETUP_SCRIPT = {
  filename: 'watai-skills-setup.py',
  content: `#!/usr/bin/env python3
"""Watai skills bootstrap. Unpack every mounted skill package into
/mnt/data/skills/<name>/ so the agent can read SKILL.md and run bundled scripts.
Idempotent: safe to run more than once. Run this once before using a skill."""
import os, re, zipfile

DATA = "/mnt/data"
DEST = os.path.join(DATA, "skills")
os.makedirs(DEST, exist_ok=True)
pat = re.compile(r"^watai-skill\\.([a-z0-9-]+)\\.v\\d+\\.zip$")
ready = []
for fn in sorted(os.listdir(DATA)):
    m = pat.match(fn)
    if not m:
        continue
    name = m.group(1)
    out = os.path.join(DEST, name)
    if not os.path.isdir(out) or not os.listdir(out):
        os.makedirs(out, exist_ok=True)
        try:
            with zipfile.ZipFile(os.path.join(DATA, fn)) as z:
                z.extractall(out)
        except Exception as e:
            print("skipped", fn, "-", e)
            continue
    ready.append(name)
if ready:
    print("Skills ready in /mnt/data/skills/:", ", ".join(sorted(set(ready))))
else:
    print("No skill packages were mounted.")
`,
};

