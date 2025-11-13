// netlify/functions/evidence.js
// Returns { title, url, abstract }
// This function queries Crossref for scholarly works related to the provided
// query string.  To provide variety in the evidence shown to the user, it
// requests multiple results and selects one at random.  The Crossref API
// returns JATS-formatted abstracts which are stripped of tags.  In case of
// error, a 500 status is returned.
exports.handler = async (event) => {
  const q = (event.queryStringParameters || {}).q || "";
  if (!q) return { statusCode: 400, body: "Missing query" };
  try {
    // Request up to 5 works so we can pick one at random.  Crossref limits
    // to 20 results per request on the free tier.  We keep it small to
    // minimize latency.
    const apiUrl = `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=5`;
    const resp = await fetch(apiUrl);
    const data = await resp.json();
    const items = data?.message?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 200, body: JSON.stringify({}) };
    }
    // Filter items to those whose titles mention diet, nutrition or related
    // keywords.  This helps avoid unrelated studies (e.g. PCOS) appearing
    // when searching for general dietary topics.  Keywords include dietary
    // terms and nutrients.  If no items match the keywords, fall back to
    // using all items.
    const KEYWORDS = [
      'diet', 'nutrition', 'nutrient', 'protein', 'carbohydrate',
      'fat', 'sodium', 'salt', 'meal', 'food', 'eating', 'exercise', 'health'
    ];
    let filtered = items.filter(it => {
      const titles = [].concat(it.title || []).concat(it['container-title'] || []);
      const t = titles.join(' ').toLowerCase();
      return KEYWORDS.some(k => t.includes(k));
    });
    if (filtered.length === 0) {
      filtered = items;
    }
    // Pick a random item among the filtered works to provide variety.
    const idx = Math.floor(Math.random() * filtered.length);
    const item = filtered[idx];
    const title = item.title?.[0] || (item['container-title'] || [])[0] || q;
    const url = item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : '');
    // Crossref returns abstracts in JATS XML; strip tags and compress
    let abstract = item.abstract || '';
    if (abstract) {
      abstract = abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    // Derive simple nutrition-related tags from the combined title and abstract.
    // We use keyword matching to infer which dietary concept the study relates to.
    // These tags can be used by the client to adjust the recommendations or
    // simply display extra context.  Mapping: protein → high-protein-snack,
    // carbohydrate/carb → low-carb, sodium/salt → low-sodium, fiber → light-clean.
    const combinedText = `${title} ${abstract}`.toLowerCase();
    const tagsFromEvidence = [];
    const pushTag = (tag) => { if (!tagsFromEvidence.includes(tag)) tagsFromEvidence.push(tag); };
    if (/protein/.test(combinedText)) pushTag('high-protein-snack');
    if (/carbohydrate|carb/.test(combinedText)) pushTag('low-carb');
    if (/sodium|salt/.test(combinedText)) pushTag('low-sodium');
    if (/fiber|fibre/.test(combinedText)) pushTag('light-clean');
    // Satvik is a cultural dietary pattern; we infer it if the study mentions
    // vegetarian diets or plant-based diets.
    if (/vegetarian|plant-based|vegan|sattvic|satvik/.test(combinedText)) pushTag('satvik');
    return { statusCode: 200, body: JSON.stringify({ title, url, abstract, tags: tagsFromEvidence }) };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};
