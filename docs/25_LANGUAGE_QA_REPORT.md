# 25-Language QA Report

This report documents the multilingual checks for MuseForge portfolio generation after the latest language and export fixes.

## Tested behavior

For each target language, the expected behavior is:

- Static labels use the selected language where translations are configured.
- Person names remain original for Latin-script languages and are transliterated for Arabic/Urdu/Hindi and other non-Latin scripts when supported.
- Project titles and custom-section headings are localized/transliterated through the display layer and backend AI output.
- Project/custom-section descriptions are requested from the AI in the selected target language.
- Weak descriptions such as a duplicate title are rejected in favor of the meaningful FactLock-approved description.
- RTL languages render with `dir="rtl"` in preview/public/export contexts.
- Technology names and links remain unchanged.

## Languages checked

| # | Language | Result | Notes |
|---|---|---|---|
| 1 | English | Pass | Default labels and descriptions preserved. |
| 2 | Urdu | Pass | RTL and Urdu labels supported. |
| 3 | Roman Urdu | Pass | Roman Urdu labels supported where configured. |
| 4 | Hindi | Pass | Devanagari labels supported. |
| 5 | Arabic | Pass | RTL and Arabic labels supported. |
| 6 | Spanish | Pass | Latin script guard active. |
| 7 | French | Pass | Labels and project title localization supported. |
| 8 | German | Pass | Labels and title localization supported. |
| 9 | Italian | Pass | Labels supported. |
| 10 | Portuguese | Pass | Labels supported. |
| 11 | Turkish | Pass | Labels and phrase localization supported. |
| 12 | Chinese | Pass | Labels and phrase localization supported. |
| 13 | Japanese | Pass | Labels and phrase localization supported. |
| 14 | Korean | Pass | Labels and phrase localization supported. |
| 15 | Russian | Pass | Cyrillic allowed only for Russian. |
| 16 | Bengali | Pass | Labels supported. |
| 17 | Punjabi | Pass | Labels supported. |
| 18 | Persian | Pass | RTL family supported. |
| 19 | Pashto | Pass | RTL family supported. |
| 20 | Sindhi | Pass | RTL family supported. |
| 21 | Malay | Pass | Labels supported. |
| 22 | Indonesian | Pass | Labels supported. |
| 23 | Thai | Pass | Script guard supported. |
| 24 | Vietnamese | Pass | Latin script guard supported. |
| 25 | Filipino | Pass | Labels supported. |

## Fixes applied during QA

- Removed fake seed reviews.
- Reworked Google button to avoid the One Tap popup error path.
- Added subheading color to export customization.
- Added additional export fonts and templates.
- Prevented weak localized descriptions from replacing stronger reviewed text.
- Strengthened backend prompts for target-language descriptions.
