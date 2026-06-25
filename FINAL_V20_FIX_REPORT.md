# MuseForge v20 Fix Report

## What was corrected

- **Manual form no longer appears in Upload CV mode.**  
  Previous CSS used `display: grid !important` on `.form-with-image`, which overrode React's inline `display: none`. Added explicit `form-hidden` / `form-visible` state classes so Upload CV mode cannot show the manual form.

- **Creator cards redesigned cleanly.**  
  Creator cards now use a soft white card style, bigger image area, and a single card hover effect. Text and image hover animations have been removed so the text does not jump, blur, recolor oddly, or create a weird effect.

- **Template and step cards cleaned.**  
  Template/How-it-works cards now use the same soft-card system with larger centered images and no text/image hover distortion.

- **Main hero image edges blended.**  
  `public/all.png` was physically feathered with transparent edges and CSS masks were strengthened, so the rectangular image border blends into the background instead of looking pasted on.

- **Form image sticky fixed on desktop.**  
  Sticky behavior was being weakened by previous overflow/display overrides. Desktop form layout now keeps parents overflow-visible and makes the creator image panel `position: sticky` with viewport-based height.

- **Back and cross buttons responsive.**  
  Both buttons are fixed-position, safe-area aware, high z-index, and constrained on small screens so they do not disappear or overlap awkwardly.

- **Responsive navbar links visible.**  
  Removed the earlier mobile `display:none` behavior by overriding navbar layout into a responsive grid with horizontally scrollable links.

- **Bio and artist statement language handling strengthened.**  
  Backend and frontend language safety checks were tightened so English prose is not accepted when a non-English selected language is expected. FactLock meta review continues to show Bio and Artist Statement as reviewable items before final generation.

## Verified checks performed in this sandbox

- `node --check src/App.js` passed.
- `node --check backend/server.js` passed.
- Confirmed `public/all.png` now has transparent feathered edges.
- Static JSX/CSS check confirmed manual form has `form-hidden` state when Upload CV tab is active.

## Limitation

A full browser click-by-click test could not be run here because npm dependencies are not installed inside the sandbox. The code-level syntax checks passed and the specific failing logic/CSS conflicts were fixed directly.
