import type { SkillPackage } from '../domain/skill';

// An original, license-clean PDF skill in the canonical Agent Skills layout
// (SKILL.md + references/ + scripts/). Content is embedded as TS strings so esbuild
// bundles it (it does not bundle loose files). Markdown intentionally uses indented
// code blocks (no backtick fences) so it embeds cleanly in a template literal.

const SKILL_MD = `---
name: pdf
description: Create, read, combine, split, rotate, and fill PDF files with Python. Use this whenever a task involves a .pdf - producing a formatted PDF report, letter, or invoice; extracting text or tables from a PDF; merging, splitting, or rotating pages; or filling a fillable PDF form.
license: MIT
metadata:
  author: watai
  version: "1"
---

# PDF toolkit

You are in a Python sandbox where the libraries reportlab, pypdf, and pdfplumber
are already installed. Save every file you produce for the user under /mnt/data/.

This skill lives at /mnt/data/skills/pdf/. It bundles deeper references and ready
scripts you can run directly - prefer running a bundled script over re-deriving it,
since scripts are deterministic and consistent.

## 1. Pick the task

- Create a PDF (report / letter / invoice): use reportlab - see "Create" below.
- Read or extract text/tables from a PDF: use pdfplumber (text + tables) or pypdf
  (quick text) - see references/REFERENCE.md.
- Combine / split / rotate pages: use pypdf - see "Combine" below.
- Fill a fillable form: read references/FORMS.md, then run scripts/pdf_fill_form.py.

If you were given a PDF, inspect it first:

    python /mnt/data/skills/pdf/scripts/pdf_inspect.py /mnt/data/your-file.pdf

It prints the page count, metadata, whether text is extractable, and any fillable
form fields (so you know if it is a form before trying to fill it).

## 2. Create a clean PDF (reportlab)

Use Platypus flowables for real layout - never one wall of text.

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors

    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate("/mnt/data/report.pdf", pagesize=A4,
                            leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    story = [Paragraph("Title", styles["Title"]), Spacer(1, 12),
             Paragraph("Body text. " * 10, styles["BodyText"])]
    doc.build(story)

Guidelines: A4 with ~2cm margins; a clear type scale (Title ~20pt, headings bold,
body ~10.5pt); shade table header rows with a subtle grid; add page numbers via an
onPage callback for multi-page documents. For HTML/CSS-driven layout instead, see
references/REFERENCE.md (WeasyPrint is NOT assumed - stick to reportlab).

## 3. Combine / split / rotate (pypdf)

    from pypdf import PdfReader, PdfWriter

    # merge
    w = PdfWriter()
    for f in ["/mnt/data/a.pdf", "/mnt/data/b.pdf"]:
        for page in PdfReader(f).pages:
            w.add_page(page)
    with open("/mnt/data/merged.pdf", "wb") as out:
        w.write(out)

    # rotate page 1 by 90 degrees, write a new file
    r = PdfReader("/mnt/data/in.pdf"); w = PdfWriter()
    for i, page in enumerate(r.pages):
        if i == 0: page.rotate(90)
        w.add_page(page)
    with open("/mnt/data/rotated.pdf", "wb") as out:
        w.write(out)

## Rules

- Always write outputs to /mnt/data/ with a sensible filename, and confirm the path
  in your reply (do NOT paste a download link - the file is delivered automatically).
- If a PDF is scanned and has no extractable text, say so rather than inventing
  content. (OCR is not guaranteed in this sandbox - see references/REFERENCE.md.)
- For advanced extraction, encryption, or troubleshooting read references/REFERENCE.md;
  for filling forms read references/FORMS.md.
`;

const REFERENCE_MD = `# PDF reference (advanced)

Read this only when the core SKILL.md recipes are not enough.

## Extract text with layout (pdfplumber)

    import pdfplumber
    with pdfplumber.open("/mnt/data/in.pdf") as pdf:
        for page in pdf.pages:
            print(page.extract_text() or "")

## Extract tables (pdfplumber)

    import pandas as pd, pdfplumber
    rows = []
    with pdfplumber.open("/mnt/data/in.pdf") as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if table and len(table) > 1:
                    rows.append(pd.DataFrame(table[1:], columns=table[0]))
    if rows:
        pd.concat(rows, ignore_index=True).to_excel("/mnt/data/tables.xlsx", index=False)

## Quick text + metadata (pypdf)

    from pypdf import PdfReader
    r = PdfReader("/mnt/data/in.pdf")
    print(len(r.pages), "pages")
    print(r.metadata)
    text = "".join((p.extract_text() or "") for p in r.pages)

## Encryption

    from pypdf import PdfReader, PdfWriter
    r = PdfReader("/mnt/data/in.pdf"); w = PdfWriter()
    for p in r.pages: w.add_page(p)
    w.encrypt("user-password")
    with open("/mnt/data/protected.pdf", "wb") as out: w.write(out)

To open an encrypted PDF: PdfReader(path).decrypt("password").

## Page numbers (reportlab onPage)

    def footer(canvas, doc):
        canvas.saveState(); canvas.setFont("Helvetica", 8)
        canvas.drawRightString(550, 20, "Page %d" % doc.page); canvas.restoreState()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)

## Scanned PDFs / OCR

pytesseract and poppler are NOT guaranteed in this sandbox. If extract_text() returns
empty for every page, the PDF is likely scanned: tell the user it has no extractable
text instead of guessing its contents.
`;

const FORMS_MD = `# Filling PDF forms

A "fillable" PDF has AcroForm fields. Confirm it does before trying:

    python /mnt/data/skills/pdf/scripts/pdf_inspect.py /mnt/data/form.pdf

If it lists form fields, fill them with the bundled script. Build a JSON object whose
keys are the exact field names from the inspection and whose values are what to enter
(use true / false for checkboxes), then:

    python /mnt/data/skills/pdf/scripts/pdf_fill_form.py /mnt/data/form.pdf /mnt/data/filled.pdf '{"full_name": "Ada Lovelace", "agree": true}'

The script sets NeedAppearances so viewers render the values, and reports any field
names you supplied that do not exist in the form (so you can correct them).

If the PDF has NO form fields, it is not fillable - you cannot "type" into it. Either
tell the user, or (if they want) overlay text at fixed positions by drawing onto each
page with reportlab and merging the overlay with pypdf (see references/REFERENCE.md
for the merge pattern).
`;

const INSPECT_PY = `#!/usr/bin/env python3
"""Inspect a PDF: page count, metadata, extractable-text check, and AcroForm fields.
Usage: python pdf_inspect.py <file.pdf>"""
import sys, json

def main():
    if len(sys.argv) < 2:
        print("usage: pdf_inspect.py <file.pdf>"); return 2
    path = sys.argv[1]
    try:
        from pypdf import PdfReader
    except Exception as e:
        print("pypdf is required:", e); return 1
    try:
        reader = PdfReader(path)
    except Exception as e:
        print("could not open PDF:", e); return 1

    info = {
        "pages": len(reader.pages),
        "encrypted": bool(getattr(reader, "is_encrypted", False)),
        "metadata": {k: str(v) for k, v in (reader.metadata or {}).items()},
    }
    # extractable text?
    sample = ""
    try:
        for p in reader.pages[:3]:
            sample += p.extract_text() or ""
    except Exception:
        pass
    info["has_extractable_text"] = bool(sample.strip())

    # form fields
    fields = []
    try:
        f = reader.get_fields() or {}
        for name, fld in f.items():
            fields.append({"name": name, "type": str(fld.get("/FT")), "value": str(fld.get("/V"))})
    except Exception:
        pass
    info["form_fields"] = fields
    info["is_fillable_form"] = len(fields) > 0

    print(json.dumps(info, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
`;

const FILL_FORM_PY = `#!/usr/bin/env python3
"""Fill an AcroForm PDF from a JSON object of {field_name: value}.
Usage: python pdf_fill_form.py <in.pdf> <out.pdf> '<json>'
Checkbox values accept true/false. Reports unknown field names you supplied."""
import sys, json

def main():
    if len(sys.argv) < 4:
        print("usage: pdf_fill_form.py <in.pdf> <out.pdf> '<json>'"); return 2
    in_path, out_path, raw = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        values = json.loads(raw)
        assert isinstance(values, dict)
    except Exception as e:
        print("third argument must be a JSON object:", e); return 2
    try:
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import NameObject, BooleanObject
    except Exception as e:
        print("pypdf is required:", e); return 1

    reader = PdfReader(in_path)
    existing = set((reader.get_fields() or {}).keys())
    if not existing:
        print("this PDF has no fillable form fields - it is not an AcroForm."); return 1
    unknown = [k for k in values if k not in existing]

    writer = PdfWriter()
    writer.append(reader)
    # render filled values in viewers
    try:
        writer.set_need_appearances_writer(True)
    except Exception:
        try:
            writer._root_object["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True)
        except Exception:
            pass
    # normalize booleans for checkboxes
    norm = {k: ("/Yes" if v is True else "/Off" if v is False else v) for k, v in values.items()}
    for page in writer.pages:
        try:
            writer.update_page_form_field_values(page, norm)
        except Exception:
            pass
    with open(out_path, "wb") as f:
        writer.write(f)

    print(json.dumps({"wrote": out_path, "filled": [k for k in values if k in existing], "unknown_fields": unknown}, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
`;

/** The bundled, license-clean PDF skill. */
export const PDF_SKILL: SkillPackage = {
  name: 'pdf',
  description:
    'Create, read, combine, split, rotate, and fill PDF files with Python. Use this whenever a task involves a .pdf - producing a formatted PDF report, letter, or invoice; extracting text or tables from a PDF; merging, splitting, or rotating pages; or filling a fillable PDF form.',
  license: 'MIT',
  metadata: { author: 'watai', version: '1' },
  version: 1,
  files: [
    { path: 'SKILL.md', text: SKILL_MD },
    { path: 'references/REFERENCE.md', text: REFERENCE_MD },
    { path: 'references/FORMS.md', text: FORMS_MD },
    { path: 'scripts/pdf_inspect.py', text: INSPECT_PY },
    { path: 'scripts/pdf_fill_form.py', text: FILL_FORM_PY },
  ],
};
