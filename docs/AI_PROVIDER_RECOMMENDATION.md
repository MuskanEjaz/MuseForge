# MuseForge AI Provider Recommendation

## Recommended free provider
Use **Gemini Developer API** for free testing and competition demos.

Recommended environment:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash
```

If your Google AI Studio account does not show Gemini 3.5 Flash yet, temporarily use:

```env
GEMINI_MODEL=gemini-1.5-flash
```

## Why not Claude as the default?
Claude is excellent for multilingual writing and reasoning, but Claude API is paid. It is not the best choice when the requirement is free testing.

## Why not OpenAI as the default?
OpenAI models are high quality, but API usage is paid. Keep OpenAI optional for later production upgrades.

## Optional paid upgrade path
```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

## Prompt strategy added in this build
- Strict language instruction for Roman Urdu, Urdu, Arabic, Hindi and other languages.
- FactLock instruction: preserve facts, do not invent metrics, tools, awards, dates or outcomes.
- Tone instruction: Professional, Creative, Minimal or Bold.
- JSON-only structured response for generated suggestions and enhancement tasks.
