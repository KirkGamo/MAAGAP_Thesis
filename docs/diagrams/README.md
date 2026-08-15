# Manuscript figure sources

Editable Mermaid sources for the architecture figures embedded in
`MAAGAP_A_Machine_Learning_Framework_...md` (repo root). The manuscript embeds
each figure as a base64 PNG data URI (`[imageN]: <data:image/png;base64,...>`);
these `.mmd` files are the source of truth for the ones listed below, so they
can be edited and re-rendered instead of redrawn by hand.

## Regenerating

```bash
npm install --no-save @mermaid-js/mermaid-cli      # one-time
node_modules/.bin/mmdc -i docs/diagrams/<name>.mmd -o docs/diagrams/<name>.png -b white -s 2
```

Then quantize (Mermaid output is flat line art, so 64-colour palette is visually
lossless and ~3x smaller — matters because these get base64-embedded, which adds
another 33%):

```python
from PIL import Image
im = Image.open(path).convert("RGB")
im.quantize(colors=64, method=Image.MEDIANCUT).save(path, optimize=True)
```

Re-embed by replacing the matching `[imageN]:` data URI in the manuscript.

## Figures with Mermaid sources

| Figure | Source | Was it stale? |
|---|---|---|
| 2 — System Architecture (four-layer) | `figure2-system-architecture.mmd` | **Yes** — depicted SQLite, Flask REST APIs, Streamlit dashboard, PDF reports |
| 3 — Software Architecture (three-tier) | `figure3-software-architecture.mmd` | **Yes** — depicted Streamlit dashboard, Flask REST API backend, PDF reports |
| 7 — Class Diagram | `figure7-class-diagram.mmd` | **No** — the raster diagram was already technology-agnostic. Converted to Mermaid for editability, with two accuracy fixes: `gradientBoost` → `xgboost` (the model actually trained) and `DashboardController` methods no longer imply a Streamlit UI |
| 9 — Deployment Diagram | `figure9-deployment-diagram.mmd` | **Yes** — depicted the SQLite-dev/PostgreSQL-prod dual-database strategy and a combined Flask/Streamlit application server |

Figure 3 is deliberately drawn at a different level of abstraction from Figure 2
to avoid redundancy: Figure 2 shows *what each layer contains*, Figure 3 shows
*how a request crosses tier boundaries at runtime* (numbered steps 1–5), and
Figure 9 shows *where each component physically runs*.

## Figure 6 (Use Case Diagram) — deliberately NOT regenerated

Mermaid has no native use-case diagram type, and a `flowchart` approximation
would look like a use-case diagram without being one (no actor stick figures, no
proper system boundary, no `<<include>>`/`<<extend>>` semantics).

More importantly, it does not need regenerating for architecture reasons: the
raster Figure 6 was inspected during the 2026-08-15 sweep and contains **no
technology references at all** — its actors and use-case ovals are stack-
agnostic. Only the *prose* describing it (manuscript line ~793) named Streamlit,
and that has been corrected.

**One outstanding manual edit**: the use-case oval labelled *"Generate Automated
PDF Reports"* should read *"Export Reports (CSV)"* — the system has no PDF
generation capability (verified: no jspdf/pdfkit/reportlab/puppeteer dependency
anywhere in the repo). This is a single label change to the existing raster
image, best done in whatever tool drew it originally. If a full redraw is ever
wanted, PlantUML has proper native use-case support (`@startuml` / `usecase` /
`actor`) and would be the right tool — not Mermaid.

## Figures not covered here

Figures 1, 4, 5, 8, 10–14 (Gantt/timeline, ERD, flowcharts, state machine, DFDs)
were not part of the stale-architecture sweep and remain as their original
embedded rasters.
