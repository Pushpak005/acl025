/*
 * profile-tags.js – Netlify function to derive diet tags from user medical data using LLM
 *
 * This endpoint accepts a POST request with user vitals (from wearable data) and
 * preferences, then uses DeepSeek LLM to determine appropriate diet tags and
 * medical flags based on current health metrics.
 *
 * Input (POST JSON body):
 *   - vitals: { heartRate, caloriesBurned, bpSystolic, bpDiastolic, steps, analysis: { activityLevel } }
 *   - preferences: { diet: 'veg'|'nonveg', satvik: boolean }
 *
 * Output:
 *   - tags: string[] - diet tags like ['high-protein', 'low-sodium', 'keto', 'satvik', etc.]
 *   - medical_flags: string[] - health concerns like ['high-bp', 'prediabetes', 'low-activity', etc.]
 *   - reasoning: string - brief explanation of why these tags were selected
 */

exports.handler = async function(event) {
  // Resolve API key from environment
  // Resolve API key from environment. If missing, use fallback heuristic mode.
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.ACL_API;

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
  const preferences = body.preferences || {};

  // If no API key is available, use fallback heuristic mode immediately
  if (!apiKey) {
    console.log('No LLM API key found, using heuristic fallback');
    return {
      statusCode: 200,
      body: JSON.stringify(generateFallbackTags(vitals, preferences))
    };
  }

  // Build a comprehensive prompt for the LLM to analyze health metrics and recommend diet tags
  const systemMsg = {
    role: 'system',
    content: `You are a clinical nutritionist and diet specialist. Based on user's current health metrics, recommend appropriate diet tags and identify any medical concerns.

Available diet tags: high-protein, low-carb, keto, satvik, low-sodium, light-clean, high-fiber, low-calorie, balanced, mediterranean, anti-inflammatory

Available medical flags: high-bp, elevated-bp, prediabetes, high-cholesterol, low-activity, high-activity, post-surgery, stress, sleep-issues, bone-healing

Respond ONLY with a valid JSON object in this exact format:
{
  "tags": ["tag1", "tag2", "tag3"],
  "medical_flags": ["flag1", "flag2"],
  "reasoning": "Brief 1-2 sentence explanation"
}

Do not include any text outside the JSON object.`
  };

  const userMsg = {
    role: 'user',
    content: `Analyze these health metrics and recommend diet tags:

Current vitals:
- Heart Rate: ${vitals.heartRate ?? 'N/A'} bpm
- Steps: ${vitals.steps ?? 'N/A'}
- Calories Burned: ${vitals.caloriesBurned ?? 'N/A'} kcal
- Blood Pressure: ${vitals.bpSystolic ?? 'N/A'}/${vitals.bpDiastolic ?? 'N/A'} mmHg
- Activity Level: ${vitals.analysis?.activityLevel ?? 'unknown'}

User preferences:
- Diet type: ${preferences.diet ?? 'any'} (veg/nonveg)
- Satvik preference: ${preferences.satvik ? 'yes' : 'no'}

Provide 3-5 diet tags that best suit this user's current condition, relevant medical flags, and a brief reasoning.`
  };

  try {
    // Determine API endpoint and model
    const useDeepSeek = !!process.env.DEEPSEEK_API_KEY;
    const apiUrl = useDeepSeek
      ? 'https://api.deepseek.com/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const model = useDeepSeek ? 'deepseek-chat' : 'gpt-3.5-turbo';

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [systemMsg, userMsg],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    const data = await resp.json();
    let answer = data?.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      // Fallback to heuristic-based tag generation if LLM fails
      return {
        statusCode: 200,
        body: JSON.stringify(generateFallbackTags(vitals, preferences))
      };
    }

    // Try to parse the JSON response
    try {
      // Extract JSON from response (in case LLM adds extra text)
      const jsonMatch = answer.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        // Validate structure
        if (Array.isArray(result.tags) && Array.isArray(result.medical_flags)) {
          return {
            statusCode: 200,
            body: JSON.stringify(result)
          };
        }
      }
    } catch (parseError) {
      // If parsing fails, use fallback
      console.warn('Failed to parse LLM response:', parseError);
    }

    // If we reach here, fallback to heuristic
    return {
      statusCode: 200,
      body: JSON.stringify(generateFallbackTags(vitals, preferences))
    };

  } catch (e) {
    console.error('LLM error:', e);
    // Return heuristic-based tags on error
    return {
      statusCode: 200,
      body: JSON.stringify(generateFallbackTags(vitals, preferences))
    };
  }
};

/**
 * Generate diet tags and medical flags using heuristic rules when LLM is unavailable
 */
function generateFallbackTags(vitals, preferences) {
  const tags = [];
  const medical_flags = [];
  let reasoning = '';

  const v = vitals || {};
  const prefs = preferences || {};

  // Medical flags based on vitals
  if ((v.bpSystolic ?? 0) >= 140 || (v.bpDiastolic ?? 0) >= 90) {
    medical_flags.push('high-bp');
  } else if ((v.bpSystolic ?? 0) >= 130 || (v.bpDiastolic ?? 0) >= 80) {
    medical_flags.push('elevated-bp');
  }

  const activityLevel = (v.analysis?.activityLevel || '').toLowerCase();
  if (activityLevel === 'low' || (v.steps ?? 0) < 3000) {
    medical_flags.push('low-activity');
  } else if (activityLevel === 'high' || (v.caloriesBurned ?? 0) > 600) {
    medical_flags.push('high-activity');
  }

  // Diet tags based on medical flags and activity
  if (medical_flags.includes('high-bp') || medical_flags.includes('elevated-bp')) {
    tags.push('low-sodium');
    tags.push('anti-inflammatory');
  }

  if (medical_flags.includes('high-activity') || (v.caloriesBurned ?? 0) > 400) {
    tags.push('high-protein');
  }

  if (medical_flags.includes('low-activity')) {
    tags.push('light-clean');
    tags.push('low-calorie');
  }

  // Preference-based tags
  if (prefs.satvik) {
    tags.push('satvik');
  }

  // Default tags if none selected
  if (tags.length === 0) {
    tags.push('balanced');
    tags.push('light-clean');
  }

  // Build reasoning
  const reasons = [];
  if (medical_flags.includes('high-bp') || medical_flags.includes('elevated-bp')) {
    reasons.push('blood pressure management');
  }
  if (medical_flags.includes('high-activity')) {
    reasons.push('high activity recovery');
  }
  if (medical_flags.includes('low-activity')) {
    reasons.push('low activity optimization');
  }

  reasoning = reasons.length > 0
    ? `Tags selected based on ${reasons.join(' and ')}.`
    : 'Balanced diet tags for general wellness.';

  return { tags, medical_flags, reasoning };
}
