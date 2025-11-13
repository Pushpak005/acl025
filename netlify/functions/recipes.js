// Use the global fetch API available in Node 18 environments.  No import needed.

// recipes.js - Netlify function to fetch recipes and compute basic macros
//
// This function queries the API Ninjas Recipe API to obtain a list of recipes
// matching a search query.  For each recipe, it then calls the API Ninjas
// Nutrition API to compute approximate macros (calories, protein, carbs, fat,
// sodium) per serving based on the ingredient list.  Finally, it derives
// simple tags (satvik, low-carb, high-protein-snack, low-sodium, light-clean)
// from the macros and ingredients and returns a simplified JSON array of
// recipes.  An API key must be supplied via the NINJAS_API_KEY environment
// variable (or RECIPE_API_KEY as a fallback).

exports.handler = async function(event) {
  const apiKey = process.env.NINJAS_API_KEY || process.env.RECIPE_API_KEY;
  // Predefine a large fallback list of wholesome dishes with approximate
  // macros.  This list is used when the API key is missing, when all
  // recipe lookups fail, or when the external API returns no results.  By
  // centralising the fallback here, we ensure consistency across all error
  // branches and provide enough variety for the UI to display multiple
  // options.  These dishes are representative of balanced meals and snacks
  // commonly recommended in India.  Macros are approximate and intended
  // for demonstration purposes only.
  const fallbackLarge = [
       {
         title: 'Fruit & Nut Oatmeal',
         hero: 'Oatmeal',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Fruit & Nut Oatmeal Bangalore order online'),
        tags: ['satvik', 'low-sodium', 'light-clean'],
        macros: { kcal: 350, protein_g: 10, carbs_g: 45, fat_g: 10, sodium_mg: 150, per: 'per serving' },
        type: 'veg'
      },
       {
         title: 'Grilled Paneer Salad',
         hero: 'Paneer',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Grilled Paneer Salad Bangalore order online'),
        tags: ['satvik', 'low-carb', 'high-protein-snack'],
        macros: { kcal: 280, protein_g: 20, carbs_g: 8, fat_g: 18, sodium_mg: 300, per: 'per serving' },
        type: 'veg'
      },
       {
         title: 'Moong Dal Khichdi (Satvik)',
         hero: 'Khichdi',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Moong Dal Khichdi (Satvik) Bangalore order online'),
        tags: ['satvik', 'light-clean', 'low-sodium'],
        macros: { kcal: 240, protein_g: 9, carbs_g: 40, fat_g: 4, sodium_mg: 180, per: 'per serving' },
        type: 'veg'
      },
       {
         title: 'Grilled Fish with Greens',
         hero: 'Grilled Fish',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Grilled Fish with Greens Bangalore order online'),
        tags: ['high-protein-snack', 'light-clean', 'low-sodium'],
        macros: { kcal: 300, protein_g: 25, carbs_g: 5, fat_g: 15, sodium_mg: 250, per: 'per serving' },
        type: 'nonveg'
      },
       {
         title: 'Greek Yogurt & Berry Cup',
         hero: 'Yogurt Cup',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Greek Yogurt & Berry Cup Bangalore order online'),
        tags: ['satvik', 'low-carb', 'high-protein-snack'],
        macros: { kcal: 200, protein_g: 15, carbs_g: 15, fat_g: 8, sodium_mg: 120, per: 'per serving' },
        type: 'veg'
      },
       {
         title: 'Mixed Vegetable Stir-fry',
         hero: 'Stir-fry',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Mixed Vegetable Stir-fry Bangalore order online'),
        tags: ['satvik', 'low-carb', 'light-clean'],
        macros: { kcal: 200, protein_g: 6, carbs_g: 15, fat_g: 12, sodium_mg: 250, per: 'per serving' },
        type: 'veg'
      },
       {
         title: 'Spiced Chickpea Bowl',
         hero: 'Chickpea',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Spiced Chickpea Bowl Bangalore order online'),
        tags: ['satvik', 'high-protein-snack'],
        macros: { kcal: 320, protein_g: 15, carbs_g: 35, fat_g: 12, sodium_mg: 300, per: 'per serving' },
        type: 'veg'
      },
       {
         title: 'Hearty Lentil Soup',
         hero: 'Lentil',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Hearty Lentil Soup Bangalore order online'),
        tags: ['satvik', 'light-clean', 'high-protein-snack'],
        macros: { kcal: 250, protein_g: 18, carbs_g: 30, fat_g: 5, sodium_mg: 350, per: 'per serving' },
        type: 'veg'
      },
       {
         title: 'Tofu & Veggie Stir-fry',
         hero: 'Tofu Stir-fry',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Tofu & Veggie Stir-fry Bangalore order online'),
        tags: ['satvik', 'high-protein-snack', 'low-carb'],
        macros: { kcal: 280, protein_g: 20, carbs_g: 10, fat_g: 15, sodium_mg: 220, per: 'per serving' },
        type: 'veg'
      },
       {
         title: 'Quinoa Pulao',
         hero: 'Quinoa Pulao',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Quinoa Pulao Bangalore order online'),
        tags: ['satvik', 'light-clean'],
        macros: { kcal: 270, protein_g: 12, carbs_g: 35, fat_g: 9, sodium_mg: 180, per: 'per serving' },
        type: 'veg'
      },
       {
         title: 'Avocado & Sprout Salad',
         hero: 'Avocado Salad',
         link: 'https://www.google.com/search?q=' + encodeURIComponent('Avocado & Sprout Salad Bangalore order online'),
        tags: ['satvik', 'low-carb', 'high-protein-snack'],
        macros: { kcal: 290, protein_g: 13, carbs_g: 12, fat_g: 22, sodium_mg: 200, per: 'per serving' },
        type: 'veg'
      }
    ];

  // If no API key is configured, return the large fallback list directly.
  if (!apiKey) {
    return { statusCode: 200, body: JSON.stringify(fallbackLarge) };
  }
  const params = event.queryStringParameters || {};
  const query = params.q || 'balanced diet';
  const limit = Number(params.limit) || 6;
  try {
    // Fetch recipes
    const recipeUrl = `https://api.api-ninjas.com/v1/recipe?query=${encodeURIComponent(query)}&limit=${limit}`;
    const recResp = await fetch(recipeUrl, { headers: { 'X-Api-Key': apiKey } });
    let recList = [];
    if (!recResp.ok) {
      // If the first query fails (e.g. 400 or 429), try a series of
      // progressively broader fallback queries.  These include common
      // healthy meal keywords and dietary concepts.  The goal is to
      // surface dishes that broadly align with wellness goals even when
      // the original query is too specific.  If all attempts fail, we
      // fall back to default dishes below.
      const fallbackQueries = [
        'healthy',                // general healthy dishes
        'vegetarian',             // plant‑based meals
        'high protein',           // protein‑rich options
        'salad',                  // light salads
        'low sodium',             // low sodium meals
        'low carb',               // low carbohydrate dishes
        'indian healthy',         // Indian‑style healthy dishes
        'satvik',                 // sattvic diet foods
        'high fiber',             // fiber‑rich foods
        'soup',                   // soups (typically lighter)
        'bangalore healthy',      // region‑specific healthy dishes for Bangalore
        'bangalore vegetarian'    // region‑specific vegetarian dishes
      ];
      let found = false;
      for (const fq of fallbackQueries) {
        const url = `https://api.api-ninjas.com/v1/recipe?query=${encodeURIComponent(fq)}&limit=${limit}`;
        try {
          const resp2 = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
          if (resp2.ok) {
            const data = await resp2.json();
            if (Array.isArray(data) && data.length > 0) {
              recList = data;
              found = true;
              break;
            }
          }
        } catch (_e) {
          // ignore and continue to next fallback query
        }
      }
      // If still not found, recList remains empty; we'll handle fallback later
    } else {
      recList = await recResp.json();
    }
    const results = [];
    for (const rec of recList) {
      // Compose a single string of ingredients.  The API returns an array of
      // ingredient strings.  If no ingredients are present, skip this item.
      const ingredientsStr = Array.isArray(rec.ingredients) ? rec.ingredients.join(', ') : '';
      if (!ingredientsStr) continue;
      // Call the nutrition endpoint to calculate macros
      let macros = {};
      try {
        const nutrUrl = `https://api.api-ninjas.com/v1/nutrition?query=${encodeURIComponent(ingredientsStr)}`;
        const nutrResp = await fetch(nutrUrl, { headers: { 'X-Api-Key': apiKey } });
        if (nutrResp.ok) {
          const nutrData = await nutrResp.json();
          // Sum macros across all ingredients
          const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_total_g: 0, sodium_mg: 0 };
          for (const item of nutrData) {
            totals.calories += item.calories || 0;
            totals.protein_g += item.protein_g || 0;
            totals.carbs_g += item.carbohydrates_total_g || 0;
            totals.fat_total_g += item.fat_total_g || 0;
            totals.sodium_mg += item.sodium_mg || 0;
          }
          // Divide by servings if provided (avoid division by zero)
          const servings = rec.servings && Number(rec.servings) > 0 ? Number(rec.servings) : 1;
          macros = {
            kcal: Math.round(totals.calories / servings),
            protein_g: Math.round(totals.protein_g / servings),
            carbs_g: Math.round(totals.carbs_g / servings),
            fat_g: Math.round(totals.fat_total_g / servings),
            sodium_mg: Math.round(totals.sodium_mg / servings),
            per: 'per serving'
          };
        }
      } catch (_e) {
        // ignore nutrition errors and leave macros empty
      }
      // Determine tags based on macros and ingredients
      const tags = [];
      // Satvik: no obvious meat or egg in ingredient list
      if (!/(chicken|fish|meat|beef|pork|mutton|egg)/i.test(ingredientsStr)) {
        tags.push('satvik');
      }
      // Low-carb: carbs < 25g per serving
      if (macros.carbs_g != null && macros.carbs_g < 25) {
        tags.push('low-carb');
      }
      // High-protein snack: protein > 20g per serving
      if (macros.protein_g != null && macros.protein_g > 20) {
        tags.push('high-protein-snack');
      }
      // Low-sodium: sodium < 400 mg per serving
      if (macros.sodium_mg != null && macros.sodium_mg < 400) {
        tags.push('low-sodium');
      }
      // Light-clean: calories < 400 per serving
      if (macros.kcal != null && macros.kcal < 400) {
        tags.push('light-clean');
      }
      // Determine vegetarian vs nonveg type
      const type = /(chicken|fish|meat|beef|pork|mutton|egg)/i.test(ingredientsStr) ? 'nonveg' : 'veg';

      // ---- LLM-assisted tag classification (Zero-shot via Hugging Face) ----
      // Use a zero-shot classification model to refine or add dietary tags.  The
      // heuristics above provide a quick first guess; however, a nutritionist
      // might classify a dish differently when considering the full list of
      // ingredients and macros.  To capture this nuance, we call the
      // Hugging Face zero-shot classification API with a list of candidate
      // labels (satvik, low-carb, high-protein-snack, low-sodium, light-clean).
      // The model returns labels with scores; we add those with scores above
      // a threshold (e.g., 0.2).  This call is synchronous and may increase
      // latency; adjust usage or limit the number of dishes scored based on
      // performance needs.
      try {
        const hfKey = process.env.HF_API_KEY;
        if (hfKey) {
          const hfInput = `Ingredients: ${ingredientsStr}\n` +
            `Macros: calories=${macros.kcal ?? 'N/A'}, protein=${macros.protein_g ?? 'N/A'}, carbs=${macros.carbs_g ?? 'N/A'}, fat=${macros.fat_g ?? 'N/A'}, sodium=${macros.sodium_mg ?? 'N/A'}`;
          const hfResp = await fetch('https://api-inference.huggingface.co/models/facebook/bart-large-mnli', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${hfKey}`
            },
            body: JSON.stringify({
              inputs: hfInput,
              parameters: {
                candidate_labels: ['satvik', 'low-carb', 'high-protein-snack', 'low-sodium', 'light-clean'],
                multi_label: true
              }
            })
          });
          if (hfResp.ok) {
            const hfData = await hfResp.json();
            const labels = hfData?.labels;
            const scores = hfData?.scores;
            if (Array.isArray(labels) && Array.isArray(scores)) {
              for (let i = 0; i < labels.length; i++) {
                const score = scores[i];
                const label = labels[i];
                if (typeof score === 'number' && score >= 0.2) {
                  const trimmed = String(label).trim();
                  if (trimmed && !tags.includes(trimmed)) tags.push(trimmed);
                }
              }
            }
          }
        }
      } catch {
        // ignore errors in classification; keep heuristic tags
      }

      // Construct a link for the recipe.  The API Ninjas recipe endpoint
      // does not provide a URL to a source page.  To give users a way to
      // explore preparation or ordering options, build a Google search link
      // based on the dish title.  We append "Bangalore order online" to
      // help surface local ordering options in the user's city.  In future
      // you could map this to a specific service like Swiggy or Zomato.
      const link = `https://www.google.com/search?q=${encodeURIComponent((rec.title || 'recipe') + ' Bangalore order online')}`;
      results.push({
        title: rec.title || 'Untitled',
        hero: rec.title ? rec.title.split(' ')[0] : 'Dish',
        link,
        tags,
        macros,
        macrosSource: 'API Ninjas',
        type
      });
    }
    // If at least one result exists, return it.  Otherwise provide a default
    // list to avoid an empty UI when the external API returns no data.
    if (results.length > 0) {
      return { statusCode: 200, body: JSON.stringify(results) };
    }
    // If no dishes were found, return the large fallback list.  This
    // prevents the UI from showing only one or two options and ensures
    // consistency across error branches.
    return { statusCode: 200, body: JSON.stringify(fallbackLarge) };
  } catch (e) {
    // On API errors (network issues, rate limits), return a single fallback
    // dish instead of an error message.  This ensures the UI remains
    // functional and does not expose internal error details.
    // On API errors (network issues, rate limits), return the large fallback
    // list instead of a single dish.  This ensures the UI remains populated
    // with multiple options and does not expose internal error details.
    return { statusCode: 200, body: JSON.stringify(fallbackLarge) };
  }
};