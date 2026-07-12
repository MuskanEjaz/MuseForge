# MuseForge — AI Creative Identity Studio

**Challenge:** July Challenge — *Reimagine Creative Industries with AI*
**Built with:** IBM Bob · IBM Granite on watsonx.ai · IBM Docling · IBM Cloud

> Every creator already has a body of work. Almost none of them have a portfolio.
> MuseForge turns what a creator has actually made into a publishable creative identity —
> in their own language — and refuses to invent a single thing they didn't do.

---

## Problem statement

Creative work does not sell itself. An illustrator, a musician, a designer, a writer — each
one carries years of real work in scattered files, and the moment they need to present it
(a gallery call, a label, a client, a grant), they hit the same three walls:

1. **Writing about your own work is hard.** Artist bios and statements are a genre most
   creators were never taught, and a blank page is where portfolios go to die.
2. **AI portfolio tools lie.** Ask a generic model to "make my bio impressive" and it will
   happily hand you *"award-winning"*, *"featured in major publications"*, *"5,000+ users"*.
   For a creator, sending out a portfolio containing a fabricated credit is not a small
   embarrassment — it is a career risk. This is the single reason most serious creators do
   not trust AI with their identity.
3. **The creative world is not English-only.** A creator in Lahore, Cairo, Seoul, or São Paulo
   is expected to present in a language that is not their own, or not present at all.

## Solution

MuseForge is a **creative identity studio**, not a text generator.

- **It starts from evidence, in any language.** Drop in a CV — written in French, Chinese, Arabic,
  Urdu, Polish, anything — and MuseForge reads it. Section headings, projects, skills, and the
  verification links embedded in the PDF are all recovered. IBM Docling reads the real structure of
  the document instead of guessing at layout. A creator should never have to translate their own
  CV into English just to be readable by a tool.
- **FactLock: AI that cannot fabricate.** Every AI-written sentence is checked against the
  creator's own words before it is ever shown. An invented number, an invented award, an
  invented client, a switched medium — all rejected, and the safe grounded draft is used
  instead. The result is published with a **FactLock Trust Report**: what was enhanced, what
  was preserved, and what was rejected.
- **17 languages, all the way down.** Not just the body text — headings, section names, the
  creative field, item labels. The output language is a hard guarantee, not a hope: if the
  model answers in the wrong language, MuseForge rejects the answer rather than shipping it.
- **Regenerate, safely.** Any section can be regenerated in place, and the same FactLock gate
  applies to the rewrite. Stronger writing, never new claims.

## Selected challenge theme

**Reimagine Creative Industries with AI.**
MuseForge targets the point where creative work becomes a creative *career*: the portfolio.
It acts as a creative partner — it interviews, structures, and phrases — while holding a line
no general-purpose generator holds: *it will not invent your credits.* Trust is the missing
primitive in AI creative tooling, and FactLock is our attempt at it.

## AI approach and architecture

```
                    ┌──────────────────────────────────────────┐
   CV / document    │  IBM Docling                             │
   ───────────────► │  structure-aware extraction              │
                    │  (headings, reading order, tables, links)│
                    └────────────────────┬─────────────────────┘
                                         │  clean structured text
                                         ▼
                    ┌──────────────────────────────────────────┐
   Free text  ─────►│  Section + link resolver                 │
                    │  sections, projects, skills, contacts;   │
                    │  each verification link matched to the   │
                    │  item it actually belongs to             │
                    └────────────────────┬─────────────────────┘
                                         │  grounded facts
                                         ▼
                    ┌──────────────────────────────────────────┐
                    │  IBM Granite on watsonx.ai               │
                    │  bio · statement · project rewrites      │
                    │  language-locked prompts                 │
                    └────────────────────┬─────────────────────┘
                                         │  candidate text
                                         ▼
        ┌────────────────────────────────────────────────────────────┐
        │  FactLock gate                                             │
        │   • invented number?        → reject                       │
        │   • invented credential?    → reject                       │
        │   • dropped original fact?  → reject                       │
        │   • switched domain?        → reject                       │
        │   • wrong language/script?  → reject                       │
        │   • weak / prompt echo?     → reject                       │
        │  rejected → grounded local draft, still in-language        │
        └────────────────────────────────┬───────────────────────────┘
                                         ▼
                    ┌──────────────────────────────────────────┐
                    │  Deterministic localisation              │
                    │  section names + labels + field from     │
                    │  dictionaries (17 languages) — correct   │
                    │  even if the model is unavailable        │
                    └────────────────────┬─────────────────────┘
                                         ▼
                       Portfolio + FactLock Trust Report
```

**Why Granite.** The prompts here are constraint-following, not free association: *stay in this
language, keep every fact, add nothing.* Granite's instruction-following behaviour suits a
system whose main job is to refuse to embellish. Granite is the primary model
(`AI_PROVIDER=watsonx`); set `WATSONX_STRICT=true` to guarantee no other model is ever used.

**Why Docling.** A CV is a layout problem before it is a language problem: two columns, tables,
headings that wrap across lines, links attached to the wrong row. Docling recovers real document
structure, which is what makes the downstream grounding trustworthy.

**Defence in depth on language.** Model output is validated for script and language; a wrong-language
answer is retried, then rejected. Structural text (section headings, labels, creative field) never
depends on the model at all — it comes from dictionaries — so the portfolio is still fully in the
selected language even if watsonx is briefly unreachable.

## How IBM Bob was used

<!-- REPLACE THIS WITH YOUR ACTUAL USAGE — judges score this, and a vague answer costs marks. -->
<!-- Be concrete. Examples of the shape they want:                                             -->
<!-- - Bob scaffolded the initial Express + React project structure.                            -->
<!-- - Bob was used to implement <specific module>, e.g. the watsonx provider / the FactLock    -->
<!--   gate / the multilingual dictionaries.                                                   -->
<!-- - Bob was used to debug <specific bug>, e.g. the PDF link reading order.                   -->
<!-- - Screenshots of the Bob sessions are in /docs.                                            -->

## Verifying the claims in this README

Nothing here is asserted without a test. All of these run offline, with no API key:

```bash
node language-e2e-test.js    # 17 languages x 100 generations through the real /generate endpoint
node regenerate-e2e-test.js  # 17 languages x 100 regenerations, incl. fabrication attempts
node cv-test-harness.js 300  # 300 generated CVs, section recall
node links-test.js           # embedded PDF link routing
node factlock-test.js        # FactLock unit tests
node urdu-arabic-test.js     # Urdu and Arabic share a Unicode block — proves they never blur
node multilang-cv-test.js    # CVs written in 17 languages, parsed
node first-person-test.js    # every section speaks as the creator, in every language
```

The language and regenerate suites drive the real endpoints against a model that **deliberately
misbehaves 40–50% of the time** (answers in English, answers in the wrong script, throws a 429,
and tries to smuggle in "5000 users"). Current results:

| Guarantee | Result |
|---|---|
| Output is in the selected language | 1700 / 1700 (100%) |
| Regeneration is in the selected language | 1700 / 1700 (100%) |
| Regeneration is a real rewrite, not an echo | 1700 / 1700 (100%) |
| Fabricated facts blocked | 170 / 170 (100%) |
| CV section recall (300 English CVs) | 100% on every section |
| CV parsing in the creator's own language (17 languages) | 11,220 / 11,220 (100%) |
| Every section written in first person, even when the model isn't | 17 / 17 languages |

To verify the IBM stack against your own account:

```bash
node verify-ibm.js            # IAM token, Granite model availability, live Granite reply, Docling
node verify-ibm.js ./cv.pdf   # also runs a real PDF through Docling
node verify-languages.js      # asks Granite for a bio in each of the 15 languages and scores it
```

## Running locally

```bash
cp .env.example .env          # fill in WATSONX_API_KEY + WATSONX_PROJECT_ID
npm install
docker run -p 5001:5001 quay.io/docling-project/docling-serve   # optional but recommended
npm start
```

## Limitations (stated plainly)

- FactLock blocks invented **numbers** in every language. Invented **credential words**
  (award, client, followers…) are caught in Latin-script output; for non-Latin output the
  number guard plus the model constraints carry that load. Extending the credential list to
  every script is the next step.
- Work titles and institution names are preserved verbatim when the model cannot translate
  them. Mangling "NCA Lahore" would be worse than leaving it.
- Urdu and Arabic share the Unicode block U+0600–U+06FF, so a model asked for one can answer in
  the other and slip past a naive script check. MuseForge separates them on Urdu-only letters
  (ٹ ڈ ڑ ے ں ھ گ) and rejects the sibling language outright — see `urdu-arabic-test.js`.
- Docling is optional. If it is not running, MuseForge falls back to local PDF parsing — the
  upload still works, but document understanding is weaker.
