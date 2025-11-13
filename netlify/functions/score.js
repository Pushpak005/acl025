/*
 * score.js – Netlify serverless function to rate a dish's suitability using DeepSeek LLM
 *
 * This endpoint accepts a POST request with a JSON body containing the user's
 * vitals (calories burned, blood pressure, activity level), the dish's
 * nutrition macros (kcal, protein_g, carbs_g, fat_g, sodium_mg) and tags,
 * and the dish title. It uses the DeepSeek Chat Completions API to obtain
 * a rating from 1 to 10 indicating how suitable the dish is for the
 * provided vitals.  The model is prompted to return only the number.  If
 * the API call fails or the response cannot be parsed as a number, the
 * function returns a default score of 0.
 */

exports.handler = async function(event) {
  const apiKey = process.env.ACL_API;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing ACL_API environment variable' }) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const vitals = body.vitals || {};
  const macros = body.macros || {};
  const tags = body.tags || [];
  const title = body.title || '';
  // Build the prompt for DeepSeek.  We instruct the model to act as a
  // nutritionist and output only a number between 1 and 10.  We include
  // the relevant metrics so the model can consider the user’s current
  // condition and the dish’s nutrient profile.  The prompt explicitly
  // requests a numeric rating and no additional commentary.
  const messages = [
    {
      role: 'system',
      content: 'You are an experienced clinical nutritionist. Rate the suitability of a dish for a user on a scale from 1 to 10, where 1 means not suitable and 10 means highly suitable. Only return the number without any words.'
    },
    {
      role: 'user',
      content:
        `User vitals: caloriesBurned=${vitals.caloriesBurned || 'N/A'}, ` +
        `bpSystolic=${vitals.bpSystolic || 'N/A'}, bpDiastolic=${vitals.bpDiastolic || 'N/A'}, ` +
        `activityLevel=${vitals.analysis?.activityLevel || 'unknown'}.\n` +
        `Dish: ${title || 'Unknown'}; tags=${(tags || []).join(', ') || 'none'}; ` +
        `macros: kcal=${macros.kcal ?? 'N/A'}, protein_g=${macros.protein_g ?? 'N/A'}, carbs_g=${macros.carbs_g ?? 'N/A'}, fat_g=${macros.fat_g ?? 'N/A'}, sodium_mg=${macros.sodium_mg ?? 'N/A'}.\n` +
        'Rate this dish between 1 and 10 and respond only with the number.'
    }
  ];
  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.0 })
    });
    const data = await resp.json();
    let score = 0;
    try {
      const text = data?.choices?.[0]?.message?.content?.trim() || '';
      // Extract the first number in the response; allow decimals but clamp
      const match = text.match(/\d+(\.\d+)?/);
      if (match) {
        score = parseFloat(match[0]);
        if (isNaN(score)) score = 0;
      }
    } catch (_e) {
      score = 0;
    }
    // Constrain the score to 0-10
    if (score < 0) score = 0;
    if (score > 10) score = 10;
    return { statusCode: 200, body: JSON.stringify({ score }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'DeepSeek error', details: e.message }) };
  }
};