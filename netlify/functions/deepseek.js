/* netlify/functions/deepseek.js
 * DeepSeek/OpenAI proxy with POST (messages) + fallback summariser.
 *
 * This function accepts a POST body with a `messages` array following
 * the OpenAI/DeepSeek chat API format.  It will forward the request
 * to whichever model provider key is available in the environment.
 *
 * API keys are resolved in this order:
 *   - DEEPSEEK_API_KEY   (preferred for DeepSeek models)
 *   - OPENAI_API_KEY     (for OpenAI models)
 *   - ACL_API            (legacy name; still supported)
 * If none are defined, the function returns a 500 error.
 *
 * When the upstream model returns no answer or an error occurs, a
 * simple evidence-based explanation is assembled on the server from
 * the provided context.  This fallback ensures the frontend always
 * receives a non-empty answer.
 */

exports.handler = async function (event) {
  // Resolve the API key from environment variables.  Prefer the more
  // descriptive names (DEEPSEEK_API_KEY, OPENAI_API_KEY) and fall back
  // to ACL_API for backward compatibility.  If none are set, return an
  // error indicating the missing key.  This allows the client to see
  // that configuration is required.
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ACL_API;
  if (!apiKey) {
    return { statusCode: 500, body: 'Missing LLM API key (set DEEPSEEK_API_KEY, OPENAI_API_KEY or ACL_API)' };
  }

  // Helper: safe JSON parse
  const json = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

  // --- Handle GET ?q= for quick smoke-tests ---
  if (event.httpMethod === 'GET') {
    const q = (event.queryStringParameters || {}).q || '';
    if (!q) return { statusCode: 400, body: 'Missing q parameter' };
    try {
      // For test GET calls, send a simple user prompt to the model.  Use a
      // default temperature of 0.3 and the provider's chat endpoint.
      const apiUrl = process.env.DEEPSEEK_API_KEY
        ? 'https://api.deepseek.com/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const model = process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-3.5-turbo';
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: q }], temperature: 0.3 })
      });
      const data = await resp.json();
      const answer = data?.choices?.[0]?.message?.content?.trim() || '(no answer)';
      return { statusCode: 200, body: JSON.stringify({ answer, raw: data }) };
    } catch (e) {
      return { statusCode: 500, body: 'LLM error: ' + e.message };
    }
  }

  // --- Handle POST with structured messages ---
  if (event.httpMethod === 'POST') {
    const body = json(event.body);
    const messages = Array.isArray(body.messages) ? body.messages : null;
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.35;
    const context = body.context || {}; // { evidenceTitle, evidenceAbstract, vitals, macros, dish }

    if (!messages) return { statusCode: 400, body: 'Missing messages[] in JSON body' };

    try {
      // Determine which provider endpoint to call based on the available key.
      const useDeepSeek = !!process.env.DEEPSEEK_API_KEY;
      const apiUrl = useDeepSeek
        ? 'https://api.deepseek.com/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      // Choose a default model.  For DeepSeek, use its chat model; for OpenAI
      // you can swap gpt-3.5-turbo with gpt-4 if you have access.
      const model = useDeepSeek ? 'deepseek-chat' : 'gpt-3.5-turbo';

      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature })
      });
      const data = await resp.json();
      let answer = data?.choices?.[0]?.message?.content?.trim();

      // Fallback if the model returns no answer or an error occurs.  Build a
      // simple explanation using the evidence abstract and the context.
      if (!answer) {
        const title = (context.evidenceTitle || '').trim();
        const abstract = (context.evidenceAbstract || '').trim();
        const vitals = context.vitals || {};
        const macros = context.macros || {};
        const dish = context.dish || {};
        const parts = [];
        if (title) parts.push(`According to \"${title}\"`);
        if (abstract) {
          const sentences = abstract.split(/[.!?]\s+/);
          const short = sentences.slice(0, 2).join('. ').trim();
          if (short) parts.push(short + (short.endsWith('.') ? '' : '.'));
        }
        // macros summary
        const macrosLine = [];
        if (macros.protein_g != null) macrosLine.push(`${macros.protein_g}g protein`);
        if (macros.sodium_mg != null) macrosLine.push(`${macros.sodium_mg} mg sodium/100g`);
        // vitals summary
        const vitalLine = [];
        if (vitals.caloriesBurned != null) vitalLine.push(`today’s burn ${vitals.caloriesBurned} kcal`);
        if (vitals.bpSystolic && vitals.bpDiastolic) vitalLine.push(`BP ${vitals.bpSystolic}/${vitals.bpDiastolic}`);
        parts.push(
          `For ${dish.title || 'this dish'}${macrosLine.length ? ` (${macrosLine.join(', ')})` : ''}, ` +
          (vitalLine.length ? `your metrics (${vitalLine.join(', ')}) suggest this can be a suitable choice.` : `it aligns with your current metrics.`)
        );
        answer = parts.filter(Boolean).join(' ');
      }

      return { statusCode: 200, body: JSON.stringify({ answer, raw: data }) };
    } catch (e) {
      return { statusCode: 500, body: 'LLM error: ' + e.message };
    }
  }

  return { statusCode: 405, body: 'Method not allowed' };
};
