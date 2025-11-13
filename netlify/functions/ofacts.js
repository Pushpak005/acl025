// netlify/functions/ofacts.js
// Proxy to OpenFoodFacts for nutrition data lookup
// Parameters: q = search terms
// Returns: { found: boolean, macros, product }

exports.handler = async (event) => {
  const q = (event.queryStringParameters || {}).q || "";
  if (!q) return { statusCode: 400, body: "Missing q" };
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=5`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    const p = (j.products || []).find(
      (x) => x.nutriments && (x.nutriments["energy-kcal_100g"] || x.nutriments["proteins_100g"])
    );
    if (!p) return { statusCode: 200, body: JSON.stringify({ found: false }) };
    const n = p.nutriments || {};
    const macros = {
      per: "100g",
      kcal: n["energy-kcal_100g"] ?? null,
      protein_g: n["proteins_100g"] ?? null,
      carbs_g: n["carbohydrates_100g"] ?? null,
      fat_g: n["fat_100g"] ?? null,
      sodium_mg: n["sodium_100g"] ? Math.round(n["sodium_100g"] * 1000) : null
    };
    return {
      statusCode: 200,
      body: JSON.stringify({
        found: true,
        macros,
        product: { name: p.product_name, brand: p.brands, url: p.url }
      })
    };
  } catch (e) {
    // If the OpenFoodFacts fetch fails (e.g. network error or API down),
    // return a graceful response instead of a 500.  This prevents 500
    // errors from appearing in the browser and allows the UI to fall back
    // on baked-in macros if available.
    return {
      statusCode: 200,
      body: JSON.stringify({ found: false, error: String(e) })
    };
  }
};