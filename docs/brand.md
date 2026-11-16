# Brand

The single written source for the Knowcelium brand. Site, app, README and docs copy follow it. The decisions are made; change them only through an issue under the rebrand epic (#182).

## Name

- **Knowcelium**: know + mycelium, pronounced "know-SEE-lee-um".
- **Short form and CLI:** `knowcel`.
- **Spelling:** "Knowcelium" in prose, "knowcelium" (lowercase) in the logo. Never "KnowCelium", "KNOWCELIUM", or "Knowcel" as the product name.

### Rejected names

So nobody suggests them again:

- **Mycel**: an open-source knowledge engine and a self-hostable AI drafting tool already use it, npm and PyPI are taken, and so are all the main domains.
- **Mycora** and **Kenning**: domains and packages taken, plus existing ML and graph-AI products.
- **Hyphae** and **Mycelia**: existing OSS projects.
- **Lore** and **Cairn**: too generic or already crowded.
- Plain biology words (Anasto, Kinshi, Rihma, Rhizomorph): their .com is taken.

### Collision check

Done on 2026-11-08: zero web hits. Free on GitHub, npm, PyPI, crates.io, Docker Hub, and as knowcelium/knowcel .com and .io. Near misses: Knowlium (planning software), Celium (GPU compute), Celiums AI, and the KNOW* trademarks Knowify, Knowlix, Knowtion and Knoware. The formal trademark search is tracked in #183.

## Story

Under every forest runs a mycelium that links tree to tree, carries what each one needs, and turns what has fallen into new growth. Knowcelium does the same for an organization's knowledge, through modules.

### The three pillars

| Pillar | What it means | Where it lives |
|---|---|---|
| **Absorb** | It grows into docs, tickets, wikis and data. | Connectors, `modules/ingestion` |
| **Connect** | It carries knowledge to every person and system. | Search, `modules/chat`, the gRPC API |
| **Renew** | It curates, and generates new content tied to its sources. | `module:curation`, roadmap |

## Taglines

- **Primary:** "The knowledge backbone of your organization."
- **Hero:** "Everything your organization knows, *connected.*" The last word gets the gradient.
- **Alternate:** "Grow what you know."

## Voice

Calm, concrete and plain, following the [UX standards](ux-standards.md).

The mycelium metaphor is for storytelling copy only (site, README, talks), at most one image per page. It never appears in UI labels, docs procedures or error messages.

## Vocabulary

| Use in storytelling copy | Keep technical in the product |
|---|---|
| network, threads, grows | module, connector, document, search, chat |

In the product, things keep their technical names. A button says "Add connector", not "Grow a thread".

## Visual identity

- **Palette "Sage":** near-neutral stone greys, an earthy sage-green accent, and ochre as the second gradient stop. The tokens live in [`platform/ui/kit/src/theme.css`](../platform/ui/kit/src/theme.css); use tokens, never raw colours.
- **Mark "Balanced star k":** a k drawn as a graph, with one centred hub, mirrored arm and leg, and edges that swell into their nodes. Single colour, in two cuts (full and small). See [Logo](#logo).
- **Typeface:** Source Serif 4 for headings, IBM Plex Sans for the interface and IBM Plex Mono for data.
- **Direction:** technical, abstract and balanced, not illustrative.

## Logo

The mark is the `Mark` component and the lockup (mark plus "knowcelium" in lowercase IBM Plex Sans semibold, tight tracking, a gap of 0.3em) is `Logo`, both in [`platform/ui/kit/src/logo.tsx`](../platform/ui/kit/src/logo.tsx). Use them instead of copying the SVG; the favicons (`apps/*/public/favicon.svg`) and the social card (`apps/site/public/og.png`) are the only static copies.

### Two cuts

One geometry on a 48-unit grid, drawn twice. `Mark` picks the cut from its size.

| Cut | Size | Use |
|---|---|---|
| Full | 32px and up | site nav, README, social card |
| Small | 24px and below | favicons, app tile, app shell sidebar; thicker waists and larger nodes keep the five nodes and the hub apart at 16px |

### Rules

- **Colour:** single colour, `currentColor`. Use `accent` on the canvas or a surface, `on-accent` on an accent tile.
- **Clear space:** one node diameter on every side.
- **Minimum size:** 16px, small cut.
- **Don't:** recolour single parts, add outlines, rotate, or use gradients.
