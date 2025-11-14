(() => {
/* Healthy Diet – Partner menus only
   - Today’s Picks come only from vendor_menus.json (Healthybee, Swad Gomantak, Shree Krishna Veg).
   - No /api/vendor-catalog.
   - No external recipe API.
   - Wearable + /api/profile-tags drive ranking.
   - Why + evidence + DeepSeek logic retained.
*/

const VENDOR_MENUS_URL  = "vendor_menus.json";
const WEARABLE_URL      = "wearable_stream.json";
const NUTRITIONISTS_URL = "nutritionists.json";

let state = {
  catalog: [], wearable: {}, page: 0, pageSize: 10, scores: [],
  model: loadModel(), recomputeTimer: null, wearableTimer: null,
  macrosCache: loadCache("macrosCache"),
  tagStats: loadCache("tagStats"),
  nutritionists: [],
  evidenceCache: loadCache("evidenceCache"),
  profileTags: { tags: [], medical_flags: [], reasoning: '' }
};

// -----------------------------------------------------------------------------
// Load vendor menus directly from vendor_menus.json
async function loadVendorMenus() {
  try {
    const data = await safeJson(VENDOR_MENUS_URL, null);
    if (!data || !Array.isArray(data.vendors)) {
      console.warn("vendor_menus.json missing or invalid");
      return;
    }
    const items = [];
    data.vendors.forEach(v => {
      (v.dishes || []).forEach(d => {
        items.push({
          ...d,
          vendorId: v.id,
          vendorName: v.name,
          vendorArea: v.area,
          vendorCity: v.city
        });
      });
    });
    if (!items.length) {
      console.warn("No dishes found in vendor_menus.json");
      return;
    }
    state.catalog = items;
    console.log(`Loaded ${items.length} dishes from vendor_menus.json`);
  } catch (e) {
    console.warn("Failed to load vendor_menus.json", e);
  }
}

// -----------------------------------------------------------------------------
// Profile tags via /api/profile-tags
async function fetchProfileTags() {
  try {
    const prefs = JSON.parse(localStorage.getItem('prefs') || '{}');
    const resp = await fetch('/api/profile-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vitals: state.wearable || {},
        preferences: prefs
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && Array.isArray(data.tags)) {
        state.profileTags = data;
        console.log('Profile tags:', data.tags.join(', '));
        console.log('Medical flags:', (data.medical_flags || []).join(', '));
        return;
      }
    }
  } catch (e) {
    console.warn('Failed to fetch profile tags:', e);
  }
  state.profileTags = { tags: [], medical_flags: [], reasoning: '' };
}

// -----------------------------------------------------------------------------
// Entry point
window.APP_BOOT = async function(){
  // clock
  setInterval(() => {
    const d = new Date(); const el = document.getElementById('clock');
    if (el) el.textContent = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }, 1000);

  // buttons
  byId('toggleDetails')?.addEventListener('click', () => {
    const box = byId('healthDetails'); box.hidden = !box.hidden;
    byId('toggleDetails').textContent = box.hidden ? 'More Health Details ▾' : 'Hide Health Details ▴';
  });
  byId('reshuffle')?.addEventListener('click', () => recompute(true));
  byId('getPicks')?.addEventListener('click', async () => {
    await pullWearable();
    await fetchProfileTags();
    await loadVendorMenus();
    recompute(true);
  });
  byId('prevBtn')?.addEventListener('click', () => {
    if (state.page > 0) { state.page--; renderCards(); }
  });
  byId('nextBtn')?.addEventListener('click', () => {
    const max = Math.max(0, Math.ceil(state.scores.length/state.pageSize) - 1);
    if (state.page < max) { state.page++; renderCards(); }
  });

  // nutritionists (if used)
  state.nutritionists = await safeJson(NUTRITIONISTS_URL, []);

  // initial data
  await pullWearable();
  await fetchProfileTags();
  await loadVendorMenus();

  // wearable polling
  state.wearableTimer = setInterval(pullWearable, 15 * 60 * 1000);

  function simulateWearableChanges(){
    const w = state.wearable || {};
    if (w.heartRate != null) {
      w.heartRate = Math.max(50, Math.min(120, w.heartRate + Math.floor(Math.random()*9 - 4)));
    }
    if (w.caloriesBurned != null) {
      w.caloriesBurned = Math.max(0, w.caloriesBurned + Math.floor(Math.random()*101 - 50));
    }
    if (w.bpSystolic != null) {
      w.bpSystolic = Math.max(90, Math.min(160, w.bpSystolic + Math.floor(Math.random()*7 - 3)));
    }
    if (w.bpDiastolic != null) {
      w.bpDiastolic = Math.max(60, Math.min(100, w.bpDiastolic + Math.floor(Math.random()*5 - 2)));
    }
    if (w.analysis && w.analysis.activityLevel) {
      const levels = ['low','moderate','high'];
      w.analysis.activityLevel = levels[Math.floor(Math.random()*levels.length)];
    }
    state.wearable = w;
    paintHealth(w);
    fetchProfileTags().then(() => recompute());
  }
  setInterval(simulateWearableChanges, 30 * 1000);

  scheduleRecomputeFromPrefs();
  recompute(true);
};

// ---------- helpers ----------
function byId(id){ return document.getElementById(id); }
async function safeJson(url, fallback){
  try{
    const r = await fetch(url);
    if(!r.ok) throw new Error(r.status);
    return await r.json();
  } catch(e){
    console.warn('Fetch failed', url, e);
    return fallback;
  }
}
function loadCache(key){
  try{ return JSON.parse(localStorage.getItem(key) || '{}'); } catch(_){ return {}; }
}
function saveCache(key, data){ localStorage.setItem(key, JSON.stringify(data)); }
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
function slug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ---------- wearable ----------
async function pullWearable(){
  const w = await safeJson(WEARABLE_URL, state.wearable || {});
  state.wearable = w;
  paintHealth(w);
  recompute(false);
}
function paintHealth(w){
  const set = (id, v) => { const el = byId(id); if (el) el.textContent = v; };
  set('m-hr', w.heartRate ?? '–');
  set('m-steps', w.steps ?? '–');
  set('m-cals', w.calories ?? '–');
  set('d-burned', w.caloriesBurned ?? '–');
  set('d-bp', (w.bpSystolic && w.bpDiastolic) ? `${w.bpSystolic}/${w.bpDiastolic}` : '–');
  set('d-activity', w.analysis?.activityLevel ?? '–');
  set('d-time', w.timestamp ? new Date(w.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString());
  const ds = byId('data-source'); if(ds) ds.textContent = 'wearable_stream.json (demo)';
  const highRisk = (w.bpSystolic||0) >= 140 || (w.bpDiastolic||0) >= 90 || (w.bloodSugar||0) >= 180;
  const banner = byId('riskBanner');
  if(!banner) return;
  if(highRisk){
    banner.hidden = false;
    banner.innerHTML = '⚠️ Health Alert — Please consult a doctor for personalized guidance.' +
      '<br/><a id="healthCollabLink" class="pill" href="https://www.fitpage.in" target="_blank" rel="noopener">Consult Partner</a>';
  } else {
    banner.hidden = true;
    banner.innerHTML = '⚠️ Your vitals suggest a high-risk pattern. Please prefer light, low-sodium items or request a human review.';
  }
}

// ---------- recompute ----------
function scheduleRecomputeFromPrefs(){
  if(state.recomputeTimer) clearInterval(state.recomputeTimer);
  const prefs = JSON.parse(localStorage.getItem('prefs') || '{}');
  const minutes = (typeof prefs.updateInterval === 'number') ? prefs.updateInterval : 60;
  if(minutes > 0){ state.recomputeTimer = setInterval(() => recompute(true), minutes * 60 * 1000); }
}

function recompute(resetPage=false){
  const prefs = JSON.parse(localStorage.getItem('prefs') || '{}');
  const filtered = state.catalog.filter(item => {
    if(prefs.diet === 'veg' && item.type !== 'veg') return false;
    if(prefs.diet === 'nonveg' && item.type !== 'nonveg') return false;
    if(prefs.satvik && !(item.tags||[]).includes('satvik')) return false;
    return true;
  });
  state.scores = filtered.map(item => ({ item, score: scoreItem(item) }))
                        .sort((a, b) => b.score - a.score);
  if(resetPage) state.page = 0;
  renderCards();
}

function scoreItem(item){
  let s = 0; const tags = item.tags || []; const w = state.wearable || {};

  tags.forEach(t => s += (state.model[t] || 0));

  const profileTags = state.profileTags?.tags || [];
  tags.forEach(tag => { if (profileTags.includes(tag)) s += 12; });

  const medicalFlags = state.profileTags?.medical_flags || [];
  if (medicalFlags.includes('high-bp') || medicalFlags.includes('elevated-bp')) {
    if (!tags.includes('low-sodium') && tags.includes('high-sodium')) s -= 8;
  }
  if (medicalFlags.includes('low-activity')) {
    if (!tags.includes('light-clean') && !tags.includes('low-calorie')) s -= 4;
  }

  if((w.caloriesBurned||0) > 400 && tags.includes('high-protein-snack')) s += 8;
  if(((w.bpSystolic||0) >= 130 || (w.bpDiastolic||0) >= 80) && tags.includes('low-sodium')) s += 10;
  if(((w.analysis?.activityLevel||'').toLowerCase()) === 'low' && tags.includes('light-clean')) s += 6;

  s += Math.random() * 1.5;

  tags.forEach(tag => {
    const stats = state.tagStats[tag] || { shown: 0, success: 0 };
    const banditScore = (stats.success + 1) / (stats.shown + 2);
    s += banditScore * 4;
  });

  if (item.llmScore != null) s += (item.llmScore * 2);
  return s;
}

// ---------- LLM score ----------
async function fetchLlmScores(recipes) {
  const w = state.wearable || {};
  for (const item of recipes) {
    try {
      const resp = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vitals: w, macros: item.macros || {}, tags: item.tags || [], title: item.title || '' })
      });
      if (resp.ok) {
        const data = await resp.json();
        const n = Number(data.score);
        item.llmScore = isNaN(n) ? 0 : n;
      } else {
        item.llmScore = 0;
      }
    } catch (_e) {
      item.llmScore = 0;
    }
  }
}

// ---------- render ----------
async function renderCards(){
  const el = byId('cards'); if(!el) return;
  const start = state.page * state.pageSize;
  const slice = state.scores.slice(start, start + state.pageSize);
  await Promise.all(slice.map(({ item }) => ensureMacros(item)));
  slice.forEach(({ item }) => {
    (item.tags || []).forEach(t => {
      if(!state.tagStats[t]) state.tagStats[t] = { shown: 0, success: 0 };
      state.tagStats[t].shown += 1;
    });
  });
  saveCache('tagStats', state.tagStats);
  el.innerHTML = slice.map(({ item }) => cardHtml(item)).join('');
  slice.forEach(({ item }) => {
    const id = slug(item.title);
    byId(`why-${id}`)?.addEventListener('click', () => toggleWhy(item));
    byId(`like-${id}`)?.addEventListener('click', () => feedback(item, +1));
    byId(`skip-${id}`)?.addEventListener('click', () => feedback(item, -1));
    byId(`review-${id}`)?.addEventListener('click', () => {
      sessionStorage.setItem('reviewItem', JSON.stringify(item));
      window.location.href = 'review.html';
    });
  });
}

function cardHtml(item){
  const id = slug(item.title);
  const vendorLabel = item.vendorName
    ? `🏪 ${escapeHtml(item.vendorName)}${item.price ? ` • ₹${item.price}` : ''}`
    : '';
  const q = `${item.title} healthy`;
  const searchUrl = `https://www.swiggy.com/search?q=${encodeURIComponent(q)}`;
  return `
    <li class="card">
      <div class="tile">${escapeHtml(item.hero || item.title)}</div>
      <div class="row-between mt8">
        <h4>${escapeHtml(item.title)}</h4>
        <div class="btn-group">
          <button class="chip" id="like-${id}" title="Like">♥</button>
          <button class="chip" id="skip-${id}" title="Skip">⨯</button>
        </div>
      </div>
      ${vendorLabel ? `<div class="muted small mt4">${vendorLabel}</div>` : ''}
      <div class="row gap8 mt6">
        <button class="pill ghost" id="why-${id}">ℹ Why?</button>
        <button class="pill ghost" id="review-${id}" title="Human review">👩‍⚕️ Review</button>
        <a class="pill" href="${searchUrl}" target="_blank" rel="noopener">🛒 Order Now</a>
      </div>
      <div class="whybox" id="whybox-${id}" hidden></div>
    </li>`;
}

// ---------- Why explanation (heuristic + evidence + LLM) ----------
function buildWhyHtml(item){
  const w = state.wearable || {};
  const personas = ["our analysis"];
  const persona = personas[0];
  const reasons = [];

  const profileTags = state.profileTags?.tags || [];
  const medicalFlags = state.profileTags?.medical_flags || [];

  if (medicalFlags.includes('high-bp') || medicalFlags.includes('elevated-bp')) {
    if ((item.tags || []).includes('low-sodium')) {
      reasons.push("blood pressure management → low sodium recommended");
    }
  }
  if (medicalFlags.includes('high-activity')) {
    if ((item.tags || []).includes('high-protein') || (item.tags || []).includes('high-protein-snack')) {
      reasons.push("high activity recovery → protein-rich meal");
    }
  }
  if (medicalFlags.includes('low-activity')) {
    if ((item.tags || []).includes('light-clean') || (item.tags || []).includes('low-calorie')) {
      reasons.push("low activity → light, nutrient-dense option");
    }
  }

  const matchedTags = (item.tags || []).filter(t => profileTags.includes(t));
  if (matchedTags.length > 0 && reasons.length === 0) {
    const tagNames = matchedTags.slice(0, 2).join(', ');
    reasons.push(`recommended diet pattern: ${tagNames}`);
  }

  if((w.caloriesBurned||0) > 400 && (item.tags || []).includes('high-protein-snack')) reasons.push("high calorie burn → protein supports recovery");
  if(((w.bpSystolic||0) >= 130 || (w.bpDiastolic||0) >= 80) && (item.tags || []).includes('low-sodium')) reasons.push("elevated BP → low sodium helps");
  if(((w.analysis?.activityLevel||'').toLowerCase()) === 'low' && (item.tags || []).includes('light-clean')) reasons.push("low activity → lighter, easy-to-digest meal");

  const tagExplain = {
    'satvik':'simple, plant-based, easy to digest',
    'low-carb':'lower carbs to avoid spikes',
    'high-protein':'higher protein to support muscle',
    'high-protein-snack':'higher protein to support muscle',
    'low-sodium':'reduced sodium for BP control',
    'light-clean':'minimal oil, clean prep',
    'balanced':'well-rounded nutrition',
    'anti-inflammatory':'anti-inflammatory benefits'
  };
  const fallback = (item.tags||[]).map(t => tagExplain[t]).filter(Boolean)[0] || 'matches your preferences';
  let why = reasons.length ? reasons.join(' • ') : fallback;

  const w2 = state.wearable || {};
  const hasVitals = (w2 && (w2.caloriesBurned != null || (w2.bpSystolic != null && w2.bpDiastolic != null) || (w2.analysis && w2.analysis.activityLevel)));
  if (hasVitals) {
    const parts = [];
    if (w2.caloriesBurned != null) parts.push('calorie burn');
    if (w2.bpSystolic != null && w2.bpDiastolic != null) parts.push('blood pressure');
    if (w2.analysis && w2.analysis.activityLevel) parts.push('activity');
    const metricsList = parts.join(', ');
    why = `${why} based on your wearable metrics (${metricsList})`;
  } else {
    why = `${why} based on your wearable metrics`;
  }

  return `<div class="whyline"><b>${persona}:</b> ${escapeHtml(why)}.</div>`;
}

function toggleWhy(item){
  const id = slug(item.title);
  const box = byId(`whybox-${id}`);
  if (!box) return;

  if (item.__reasonHtml) {
    box.innerHTML = item.__reasonHtml;
    box.hidden = false;
    return;
  }

  box.hidden = false;
  box.innerHTML = buildWhyHtml(item);
  box.innerHTML += '<div class="loading">Fetching evidence and AI reasoning…</div>';

  ensureMacros(item).then(() => {
    const tags = item.tags || [];
    const tag = tags[0];
    const fetchEv = item.__evidence ? Promise.resolve(item.__evidence) : fetchEvidenceForTag(tag).then(ev => {
      item.__evidence = ev; return ev;
    });
    fetchEv.then(async (ev) => {
      if(ev && ev.url){
        box.innerHTML += `<br><span class="muted small">Evidence: <a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener">View study</a></span>`;
      }
      const evidenceAbstract = ev?.abstract || '';
      const w = state.wearable || {};
      const macros = item.macros || {};
      const systemMsg = {
        role: 'system',
        content: `You are a clinical nutritionist. Always: 
- Say: "According to the study shown in evidence, ..." (never reveal the full study title).
- Give a 1–2 sentence summary of that study.
- Add a correlation/proving statement tying the study's findings to the user's current metrics AND the dish's tags/macros.
- If applicable, list relevant points from this 4-point block with 1–2 matching foods: 1) higher stress markers → calming, anti-inflammatory foods; 2) lower calorie burn & steps → balanced, nutrient-dense but not calorie-heavy; 3) sleep issues → magnesium-rich, sleep-supportive foods; 4) support bone healing → protein, calcium, vitamin D.
- End with: So our dish "${item.title}" best fulfils these for you today.
Keep the answer under 120 words.`
      };
      const userMsg = {
        role: 'user',
        content: `User metrics now: heartRate=${w.heartRate ?? 'NA'}, caloriesBurned=${w.caloriesBurned ?? 'NA'}, steps=${w.steps ?? 'NA'}, bloodPressure=${w.bpSystolic ?? 'NA'}/${w.bpDiastolic ?? 'NA'}.
Recommended diet patterns (LLM-generated): ${(state.profileTags?.tags || []).join(', ') || 'none'}.
Medical flags: ${(state.profileTags?.medical_flags || []).join(', ') || 'none'}.
Dish tags: ${(item.tags || []).join(', ') || 'none'}.
Dish macros (per 100g): kcal=${macros.kcal ?? 'NA'}, protein=${macros.protein_g ?? 'NA'}g, carbs=${macros.carbs_g ?? 'NA'}g, fat=${macros.fat_g ?? 'NA'}g, sodium=${macros.sodium_mg ?? 'NA'}mg.
Evidence abstract: ${(evidenceAbstract).slice(0, 1200)}.`
      };
      let answer = '';
      try{
        const resp = await fetch('/api/deepseek', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [systemMsg, userMsg], temperature: 0.4,
            context: { evidenceTitle: ev?.title, evidenceAbstract, vitals: w, macros, dish: { title: item.title, tags: item.tags } }
          })
        });
        if(resp.ok){
          const data = await resp.json();
          answer = (data && data.answer && data.answer.trim() && data.answer !== '(no answer)') ? String(data.answer).trim() : '';
        }
      } catch(_e) {}

      if(!answer){
        let summary = '';
        if (evidenceAbstract) {
          const sentences = evidenceAbstract.split(/[.!?]\s+/);
          summary = sentences.slice(0, 2).join('. ').trim();
        }
        const corrParts = [];
        corrParts.push('1. For higher stress markers → calming, anti-inflammatory foods (try fish, leafy greens, citrus)');
        corrParts.push('2. For lower calorie burn & steps → balanced, nutrient-dense meals (beans, greens, lean protein)');
        corrParts.push('3. For sleep issues → magnesium-rich foods (spinach, quinoa, nuts)');
        corrParts.push('4. To support bone healing → protein, calcium, vitamin D (fish, dairy, leafy greens)');
        answer = `Your health data is similar to the health data of subject mentioned in the study of the evidence. ${summary ? summary + '. ' : ''}` +
                 `However, the recommended diet will be:\n${corrParts.join(' \n')}\nSo our dish "${item.title}" best fulfils these for you today.`;
      }
      const htmlReason = escapeHtml(answer).replace(/\n/g, '<br>');
      box.innerHTML += `<br><span class="muted small">AI reason: ${htmlReason}</span>`;
      const loading = box.querySelector('.loading'); if(loading) loading.remove();
      item.__reasonHtml = box.innerHTML;
    }).catch(() => {
      const generic = 'Based on your personalised health data and the provided evidence, this dish likely aligns with your current metrics.';
      box.innerHTML += `<br><span class="muted small">AI reason: ${escapeHtml(generic)}</span>`;
      const loading = box.querySelector('.loading'); if(loading) loading.remove();
      item.__reasonHtml = box.innerHTML;
    });
  });
}

// ---------- evidence lookup ----------
const EVIDENCE_QUERIES = {
  'low-sodium': [
    'low sodium diet blood pressure clinical trial',
    'salt intake hypertension study',
    'reduced salt cardiovascular health',
    'sodium reduction and heart disease',
    'low salt diet and stroke prevention'
  ],
  'high-protein-snack': [
    'protein intake muscle recovery study',
    'high protein snack benefits',
    'protein snack exercise recovery',
    'post-workout protein snack research',
    'protein consumption and muscle synthesis'
  ],
  'light-clean': [
    'light meal digestion benefits',
    'small meal digestion study',
    'light dinner health benefits',
    'low-fat meal digestive efficiency',
    'healthy light meals research'
  ],
  'satvik': [
    'sattvic diet health benefits',
    'sattvic food benefits',
    'ayurvedic sattvic diet',
    'satvik lifestyle research',
    'sattvic diet scientific evidence'
  ],
  'low-carb': [
    'low carbohydrate diet blood sugar control',
    'low carb diet study weight loss',
    'reduced carbohydrate health benefits',
    'ketogenic diet clinical trial',
    'low carb diet and cholesterol'
  ]
};

const STATIC_EVIDENCE = {
  'low-sodium': { title:'Reducing sodium intake lowers blood pressure', url:'https://www.nih.gov/news-events/news-releases/low-sodium-diet-benefits-blood-pressure' },
  'high-protein-snack': { title:'Why protein matters after exercise', url:'https://www.bhf.org.uk/informationsupport/heart-matters-magazine/nutrition/ask-the-expert/why-is-protein-important-after-exercise' },
  'light-clean': { title:'Heavy meals can make you feel sluggish', url:'https://health.clevelandclinic.org/should-you-eat-heavy-meals-before-bed' },
  'low-carb': { title:'Eating protein/veg before carbs helps control blood glucose', url:'https://www.uclahealth.org/news/eating-certain-order-helps-control-blood-glucose' },
  'satvik': { title:'What Is the Sattvic Diet? Review, Food Lists, and Menu', url:'https://www.healthline.com/nutrition/sattvic-diet-review' }
};

async function fetchEvidenceForTag(tag){
  if(!tag) return null;
  let query;
  const list = EVIDENCE_QUERIES[tag];
  if (Array.isArray(list) && list.length > 0) {
    const idx = Math.floor(Math.random() * list.length);
    query = list[idx];
  } else {
    query = `${tag} diet health benefits`;
  }
  try{
    const r = await fetch(`/api/evidence?q=${encodeURIComponent(query)}`);
    if(!r.ok) throw new Error('evidence fetch failed');
    const j = await r.json();
    if(j && j.title){
      return j;
    }
  } catch(_e){}
  if(STATIC_EVIDENCE[tag]){
    return STATIC_EVIDENCE[tag];
  }
  return null;
}

// ---------- macros via OpenFoodFacts ----------
async function ensureMacros(item){
  if(item.macros) return;
  const cached = state.macrosCache[item.title];
  if(cached && Date.now() - (cached.ts || 0) < 7 * 24 * 60 * 60 * 1000){
    item.macros = cached.macros; item.macrosSource = cached.source; return;
  }
  try{
    const r = await fetch(`/api/ofacts?q=${encodeURIComponent(item.title)}`);
    if(r.ok){
      const j = await r.json();
      if(j.found && j.macros){
        item.macros = j.macros;
        item.macrosSource = 'OpenFoodFacts';
        state.macrosCache[item.title] = { ts: Date.now(), macros: item.macros, source: item.macrosSource };
        saveCache('macrosCache', state.macrosCache);
      }
    }
  } catch(_e){}
}

// ---------- feedback / learning ----------
function feedback(item, delta){
  (item.tags || []).forEach(t => {
    state.model[t] = (state.model[t] || 0) + delta * 2;
    state.model[t] = clamp(state.model[t], -20, 40);
    if(!state.tagStats[t]) state.tagStats[t] = { shown: 0, success: 0 };
    if(delta > 0) state.tagStats[t].success += 1;
  });
  saveModel(state.model);
  saveCache('tagStats', state.tagStats);
  recompute();
}

// ---------- model store ----------
function loadModel(){ try{ return JSON.parse(localStorage.getItem('userModel') || '{}'); } catch(_){ return {}; } }
function saveModel(m){ localStorage.setItem('userModel', JSON.stringify(m)); }

})();
