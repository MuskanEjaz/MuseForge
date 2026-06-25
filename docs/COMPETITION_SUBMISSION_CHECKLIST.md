# MuseForge Competition Submission Checklist

Before final submission, complete this checklist.

## Required

- [ ] Public GitHub repository
- [ ] README includes problem statement
- [ ] README includes solution description
- [ ] README includes AI architecture
- [ ] README includes selected challenge theme
- [ ] README includes how IBM Bob was used
- [ ] `docs/ibm-bob-evidence/` contains cropped/blurred Bob screenshots
- [ ] `docs/IBM_BOB_USAGE_LOG_TEMPLATE.md` is filled with real Bob usage entries
- [ ] Public demo or presentation video, maximum 3 minutes
- [ ] Project submission page on challenge platform

## Strongly Recommended

- [ ] Live deployed app URL
- [ ] Real user testing evidence with at least 10 testers
- [ ] IBM Bob usage screenshots
- [ ] Demo video shows FactLock review
- [ ] FactLock is introduced in the first 60 seconds of the demo
- [ ] Demo explains why FactLock prevents unsupported AI claims
- [ ] Demo video shows multi-language output
- [ ] Demo video shows shareable portfolio URL
- [ ] Persistent link storage configured with Supabase for deployment
- [ ] `/health` shows `publicPortfolioStorage: "supabase"` on deployed backend
- [ ] Secrets removed from GitHub
- [ ] `.env` files ignored
- [ ] `node_modules` ignored

## Final Demo Story

1. Problem: creators need authentic portfolios; AI can hallucinate.
2. Solution: MuseForge generates portfolios from real creator details.
3. Differentiator: FactLock review prevents unsupported claims.
4. Multilingual: input can be in any language; output language is selectable.
5. Output: shareable portfolio URL and export.
6. IBM Bob: explain how Bob was used as primary development tool.


## Demo Priority Order

1. FactLock review
2. Multi-language generation
3. Shareable public URL
4. IBM Bob proof
