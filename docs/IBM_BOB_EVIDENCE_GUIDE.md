# IBM Bob Evidence Guide

Use this guide to make the IBM Bob proof clean, judge-friendly, and believable.

## What to include

Add screenshots in:

```text
docs/ibm-bob-evidence/
```

Recommended screenshot set:

1. `bob-01-project-planning.png` — Bob planning the problem, audience, or challenge fit.
2. `bob-02-architecture.png` — Bob helping with React/Node architecture.
3. `bob-03-auth-flow.png` — Bob helping design login/signup/verification/reset flow.
4. `bob-04-factlock-feature.png` — Bob helping define FactLock or hallucination-safe enhancement.
5. `bob-05-multilingual-support.png` — Bob helping with language selector/output behavior.
6. `bob-06-shareable-links.png` — Bob helping with public portfolio links.
7. `bob-07-testing-debugging.png` — Bob helping fix bugs or improve tests.

## What not to do

Do not add screenshots that expose:

- Gmail App Password
- Groq key
- Supabase service role key
- Google Client Secret
- private emails/passwords

Crop or blur secrets before adding screenshots.

## Usage log format

Fill `docs/IBM_BOB_USAGE_LOG_TEMPLATE.md` like this:

```text
Date: 2026-__-__
Goal: Build FactLock review layer
IBM Bob prompt/task: Asked Bob to design a way to improve project descriptions without adding fake achievements.
Bob output/recommendation: Show original vs enhanced text and list preserved facts plus unsupported facts.
What changed in MuseForge: Added FactLock review cards and backend fact-preserving prompt.
Evidence: docs/ibm-bob-evidence/bob-04-factlock-feature.png
Commit/file affected: src/App.js, backend/server.js
```

## README proof

After screenshots are added, update the README section **How IBM Bob Was Used** with:

- total number of screenshots
- 4 to 6 concrete features influenced by Bob
- exact evidence folder path
- a sentence saying IBM Bob was used as the primary development tool

## Submission proof line

Use this in the challenge submission page:

```text
IBM Bob was used as the primary development tool for problem planning, feature specification, authentication flow, FactLock AI design, multilingual portfolio behavior, shareable links, and debugging. Evidence screenshots and a usage log are included in docs/ibm-bob-evidence and docs/IBM_BOB_USAGE_LOG_TEMPLATE.md.
```
