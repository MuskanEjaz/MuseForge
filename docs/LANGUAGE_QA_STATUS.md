# MuseForge Language QA Status

This file is for competition/testing evidence. The current build contains strengthened prompts, frontend labels, backend fallback dictionaries, and extra mixed Roman Urdu handling for the most important languages.

| Language | Status | Coverage checked |
|---|---:|---|
| English | Pass | Labels, projects, contact, FactLock, export |
| Urdu | Pass | Urdu script labels + fallback phrases |
| Arabic | Pass | Arabic script, RTL portfolio layout, contact/location fallback |
| Spanish | Pass | Spanish labels + Roman Urdu mixed-input fallback |
| Hindi | Pass | Devanagari labels + fallback phrases |
| Roman Urdu | Pass | Roman Urdu labels + no Urdu-script fallback in Roman Urdu mode |
| Chinese | Partial | Labels and known fallback phrases added; needs more manual QA |
| Turkish | Partial | Labels and known fallback phrases added; needs more manual QA |
| French | Partial | Labels and known fallback phrases added; needs more manual QA |
| German | Partial | Labels and known fallback phrases added; needs more manual QA |
| Japanese | Partial | Labels and known fallback phrases added; needs more manual QA |
| Korean | Partial | Labels and known fallback phrases added; needs more manual QA |
| Other configured languages | Pending | Manual QA required |

## Important testing note
AI output quality depends on the configured AI provider. For free testing, use `AI_PROVIDER=gemini` and `GEMINI_MODEL=gemini-3.5-flash`. For paid higher consistency, use `AI_PROVIDER=openai` and `OPENAI_MODEL=gpt-4o-mini`.
