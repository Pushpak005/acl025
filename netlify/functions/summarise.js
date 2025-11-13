/*
 * summarise.js – Netlify serverless function for summarising long research text.
 *
 * This function accepts POST requests with a JSON body containing a `text` field.
 * It uses Hugging Face’s inference API to generate a concise summary.  You can
 * obtain a free API key from https://huggingface.co/settings/tokens.  Set the
 * key as an environment variable `HF_API_KEY` in your Netlify site.  If
 * preferred, replace this call with another open summarisation service.
 */

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }
  const text = payload.text;
  if (!text || typeof text !== 'string') {
    return { statusCode: 400, body: 'Missing text' };
  }
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: 'Missing HF_API_KEY environment variable' };
  }
  try {
    const resp = await fetch('https://api-inference.huggingface.co/models/facebook/bart-large-cnn', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: text, parameters: { max_length: 200, min_length: 50, do_sample: false } })
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { statusCode: resp.status, body };
    }
    const data = await resp.json();
    // The response is an array of summaries.  Use the first one.
    const summary = Array.isArray(data) && data.length ? data[0].summary_text : '';
    return { statusCode: 200, body: JSON.stringify({ summary }) };
  } catch (e) {
    return { statusCode: 500, body: 'Summarisation error: ' + e.message };
  }
};