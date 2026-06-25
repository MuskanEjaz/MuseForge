# IBM Bob Usage Log Template

Use this file to document how IBM Bob was used as the primary development tool. Add screenshots or links where possible.

## Entry Format

### Date

### Goal

### IBM Bob prompt or task

### Bob output or recommendation

### What changed in MuseForge

### Evidence

- Screenshot filename:
- Commit hash:
- Feature affected:

---

## Example Entry

### Date

2026-__-__

### Goal

Improve MuseForge project-description enhancement so AI does not add fake achievements.

### IBM Bob prompt or task

Asked IBM Bob to design a fact-preserving review layer for AI portfolio writing.

### Bob output or recommendation

Recommended showing original vs enhanced descriptions and allowing users to accept, edit, or keep original.

### What changed in MuseForge

Implemented FactLock review panel in the React app and added backend metadata for preserved facts and unsupported facts.

### Evidence

- Screenshot filename: `docs/evidence/bob-factlock-prompt.png`
- Commit hash: `add-after-commit`
- Feature affected: FactLock AI Enhancement
