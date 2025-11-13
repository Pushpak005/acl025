Healthy Diet — FREE-ONLY build

What this does (no paid APIs, no keys):
- Wearable demo data (wearable_stream.json) polled every 60s.
- Smart picks update hourly (user can change frequency in Preferences).
- Nutrition macros fetched via /api/ofacts (OpenFoodFacts, FREE, no key).
- Provenance shown on each card (source + model).

Deploy on Netlify (free):
1) Drag-drop this folder into Netlify (or connect a Git repo).
2) Ensure netlify.toml exists (already included). It routes /api/* to functions.
3) Done. No environment variables required.

How to test locally (quickest):
- Use Netlify CLI (optional): `npm i -g netlify-cli` then `netlify dev` in this folder.

Future upgrades (when you’re ready, optional):
- Add USDA key in a new function for better macros.
- Add LLM explanation function for evidence-aware “Why?” (OpenAI key).
- Add payments (Razorpay/Stripe) for human nutritionist reviews.

Privacy & IP:
- Wearable data stays local in the browser.
- No secrets in frontend; the ONLY API used is free and public.
- Your recommendation logic remains your IP.
