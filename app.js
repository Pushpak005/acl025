(() => {
/* Healthy Diet – Enhanced Build (light theme)
   - Poll wearable every 60 seconds.
   - Re-rank picks based on user preferences and vitals.  Preferences can be
     updated from the Preferences page.
   - Nutrition macros are fetched on demand via a Netlify function calling
     OpenFoodFacts (no API key required).  Results are cached locally.
   - Evidence for each tag is fetched via another Netlify function calling
     Crossref, returning the paper title, URL and abstract.  This is cached
     locally as well.
   - The “Why?” button combines a rule-based heuristic with research
     evidence and a DeepSeek LLM call.  A detailed prompt is constructed
     using the user’s vitals, dish macros/tags and evidence.  The LLM is
     called through a serverless proxy (/api/deepseek).  If the model
     returns no text, a fallback summary is generated from the research
     abstract (first one or two sentences), or the heuristic explanation
     itself is reused.  This ensures the user always sees an answer.
   - Likes and skips are stored locally to bias future recommendations via a
     simple bandit algorithm.  The more a user likes dishes with a given
     tag, the more weight that tag gets in ranking.
*/

const CATALOG_URL  = "food_catalog.json";
const WEARABLE_URL = "wearable_stream.json";
const NUTRITIONISTS_URL = "nutritionists.json";

let state = {
  catalog: [], wearable: {}, page: 0, pageSize: 10, scores: [],
  model: loadModel(), recomputeTimer: null, wearableTimer: null,
  macrosCache: loadCache("macrosCache"),
  // bandit stats: counts of how often tags were shown and liked
  tagStats: loadCache("tagStats"),
  // nutritionist data loaded from nutritionists.json
  nutritionists: [],
  // cache for evidence lookups (tag -> { title, url, abstract })
  evidenceCache: loadCache("evidenceCache"),
  // LLM-generated profile tags based on user's medical data
  profileTags: { tags: [], medical_flags: [], reasoning: '' },
  // Flag to track if we're using vendor catalog
  usingVendorCatalog: false,
  // User location, populated from browser geolocation on boot
  userLocation: { city: 'Pune', area: 'Wakad' }
};

// -----------------------------------------------------------------------------
// Recipe loading
//
// To provide a wide variety of dishes without storing a static catalog, this
// function queries our Netlify serverless function `/api/recipes`, which in
// turn calls an external recipe API (API Ninjas).  It sets state.catalog to
// the returned array of dishes.  If the call fails (e.g. missing API key),
// state.catalog remains unchanged.  The query parameter can be adjusted
// according to user preferences (diet type, etc.) but defaults to a balanced
// diet.  A `limit` of 6 is used to match the number of cards displayed.
async function loadRecipes() {
  try {
    const prefs = JSON.parse(localStorage.getItem('prefs') || '{}');
    /*
      Build a search query for the recipe API based on the user's current
      health metrics and diet preferences.  We bias the search to surface
      dishes that match the user's needs: high protein after a big calorie
      burn, low sodium for high blood pressure, or light meals for low
      activity.  We then append a vegetarian/non‑vegetarian tag based on
      preferences to further filter results.  This produces queries like
      "high protein healthy vegetarian" or "low sodium diet nonveg".  If
      no specific condition applies, default to a balanced diet.
    */
    let query = 'balanced diet';
    try {
      const w = state.wearable || {};
      // adjust query based on vitals
      if ((w.caloriesBurned || 0) > 400) {
        query = 'high protein healthy';
      }
      if (((w.bpSystolic || 0) >= 130 || (w.bpDiastolic || 0) >= 80)) {
        query = 'low sodium diet';
      }
      if (((w.analysis?.activityLevel || '').toLowerCase()) === 'low') {
        query = 'light meal';
      }
      // adjust query based on diet preference
      if (prefs.diet === 'veg') {
        query = `${query} vegetarian healthy`;
      } else if (prefs.diet === 'nonveg') {
        query = `${query} chicken`;
      }
    } catch (_e) {
      // ignore errors in wearable parsing; use default query
    }
    // Request a larger pool of recipes (up to 12) so we can display more
    // options to the user.  We later rank and paginate these results on
    // the client.  If fewer than 12 are available the API will return
    // whatever it can.
    const resp = await fetch(`/api/recipes?q=${encodeURIComponent(query)}&limit=20`);
    if (resp.ok) {
      const arr = await resp.json();
      if (Array.isArray(arr) && arr.length > 0) {
        // populate the catalog with fresh recipes
        state.catalog = arr;
        // fetch LLM suitability scores for each recipe.  This function will
        // call the serverless /api/score endpoint to obtain a rating from
        // 1–10 based on the user’s vitals and macros.  The score is stored
        // in item.llmScore and later used in ranking.
        await fetchLlmScores(state.catalog);
        return;
      }
    }
  } catch (e) {
    console.warn('Failed to fetch recipes', e);
  }
  // If fetch fails or returns nothing, leave state.catalog as is
}

// -----------------------------------------------------------------------------
// Geolocation-based user location
//
// Use the browser's Geolocation API to infer where the user is. For now we
// still map any coordinates to Pune/Wakad (your launch area), but this hook
// lets us plug in real reverse-geocoding later.
async function detectUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn('Geolocation not available, falling back to Pune/Wakad');
      return resolve({ city: 'Pune', area: 'Wakad' });
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        console.log('User coordinates', latitude, longitude);

        // TODO: replace this with a reverse-geocode API call to map lat/lng
        // to (city, area). For now we always use Pune/Wakad where your
        // current vendors are located.
        resolve({ city: 'Pune', area: 'Wakad' });
      },
      (err) => {
        console.warn('Geolocation error, using Pune/Wakad', err);
        resolve({ city: 'Pune', area: 'Wakad' });
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 5 * 60 * 1000
      }
    );
  });
}

// -----------------------------------------------------------------------------
// Vendor catalog loading
//
// Load and filter vendor menus from our partner restaurants. This function
// queries the serverless /api/vendor-catalog endpoint which transforms the
// raw partner_menus.json data into a catalog format with tags, types, and
// location information. The catalog is filtered by user location and we rely
// on scoring and profile tags to boost the most relevant dishes.
async function loadVendorCatalog() {
  try {
    // Prefer geolocation-based userLocation; fall back to Pune/Wakad.
    const loc = state.userLocation || { city: 'Pune', area: 'Wakad' };
    const locationParam = `${loc.city}|${loc.area}`;

    const prefs = JSON.parse(localStorage.getItem('prefs') || '{}');

    const params = new URLSearchParams();
    params.append('location', locationParam);

    const resp = await fetch(`/api/vendor-catalog?${params.toString()}`);
    if (resp.ok) {
      const arr = await resp.json();
      if (Array.isArray(arr) && arr.length > 0) {
        // Successfully loaded vendor catalog
        state.catalog = arr;
        state.usingVendorCatalog = true;
        console.log(`Loaded ${arr.length} vendor menu items for location ${locationParam}`);

        // Fetch LLM scores for vendor items
        await fetchLlmScores(state.catalog);
        return true;
      }
    }
  } catch (e) {
    console.warn('Failed to load vendor catalog:', e);
  }

  // If vendor catalog fails, flag will remain false and we'll use fallback
  state.usingVendorCatalog = false;
  return false;
}

// -----------------------------------------------------------------------------
// Profile tags generation
//
// Call the LLM-powered /api/profile-tags endpoint to derive diet tags and
// medical flags from the user's current vitals and preferences. This provides
// personalized recommendations based on real-time health data rather than
// static tags. The result is stored in state.profileTags and used to boost
// matching dishes in the scoring algorithm.
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

  // Fallback: use empty tags if API fails
  state.profileTags = { tags: [], medical_flags: [], reasoning: '' };
}

// Entry point called from index.html once DOM is ready
window.APP_BOOT = async function(){
  // update the clock every second
  setInterval(() => {
    const d = new Date(); const el = document.getElementById('clock');
    if (el) el.textContent = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }, 1000);

  // attach button actions
  byId('toggleDetails')?.addEventListener('click', () => {
    const box = byId('healthDetails'); box.hidden = !box.hidden;
    byId('toggleDetails').textContent = box.hidden ? 'More Health Details ▾' : 'Hide Health Details ▴';
  });
  byId('reshuffle')?.addEventListener('click', () => recompute(true));
  byId('getPicks')?.addEventListener('click', async () => {
    // Refresh profile tags and catalog when user clicks Get Picks
    await fetchProfileTags();

    // Detect location each time Get Picks is clicked (optional)
    state.userLocation = await detectUserLocation();
    console.log('Detected userLocation (Get Picks)', state.userLocation);

    // Try to load vendor catalog first; if it fails, fall back to recipes
    const vendorLoaded = await loadVendorCatalog();
    if (!vendorLoaded) {
      console.log('Vendor catalog unavailable, using recipe fallback');
      await loadRecipes();
    }

    recompute(true);
  });
  byId('prevBtn')?.addEventListener('click', () => {
    if (state.page > 0) { state.page--; renderCards(); }
  });
  byId('nextBtn')?.addEventListener('click', () => {
    const max = Math.max(0, Math.ceil(state.scores.length/state.pageSize) - 1);
    if (state.page < max) { state.page++; renderCards(); }
  });

  // load static catalog and nutritionists as fallbacks
  state.catalog = await safeJson(CATALOG_URL, []);
  state.nutritionists = await safeJson(NUTRITIONISTS_URL, []);

  // initial wearable read - must happen before profile tags
  await pullWearable();

  // Generate LLM-driven profile tags based on current vitals
  await fetchProfileTags();

  // NEW: detect location via browser and store in state
  state.userLocation = await detectUserLocation();
  console.log('Detected userLocation (boot)', state.userLocation);

  // NEW: Try to load vendor catalog first. This replaces the generic recipe
  // loading with real vendor menus filtered by location and availability.
  // If vendor catalog fails, fall back to the existing recipe API.
  const vendorLoaded = await loadVendorCatalog();
  if (!vendorLoaded) {
    console.log('Vendor catalog unavailable, falling back to recipe API');
    await loadRecipes();
  }

  // Poll the wearable file less frequently to allow simulated changes to
  // persist...
  state.wearableTimer = setInterval(pullWearable, 15 * 60 * 1000);

  function simulateWearableChanges(){
    const w = state.wearable || {};
    // Randomly vary heart rate within a small range
    if (w.heartRate != null) {
      w.heartRate = Math.max(50, Math.min(120, w.heartRate + Math.floor(Math.random()*9 - 4)));
    }
    // Randomly vary calories burned (simulate activity)
    if (w.caloriesBurned != null) {
      w.caloriesBurned = Math.max(0, w.caloriesBurned + Math.floor(Math.random()*101 - 50));
    }
    // Randomly vary blood pressure slightly
    if (w.bpSystolic != null) {
      w.bpSystolic = Math.max(90, Math.min(160, w.bpSystolic + Math.floor(Math.random()*7 - 3)));
    }
    if (w.bpDiastolic != null) {
      w.bpDiastolic = Math.max(60, Math.min(100, w.bpDiastolic + Math.floor(Math.random()*5 - 2)));
    }
    // Randomly change activity level
    if (w.analysis && w.analysis.activityLevel) {
      const levels = ['low','moderate','high'];
      w.analysis.activityLevel = levels[Math.floor(Math.random()*levels.length)];
    }
    state.wearable = w;
    paintHealth(w);

    // Refresh profile tags when vitals change significantly
    fetchProfileTags().then(() => recompute());
  }
  setInterval(simulateWearableChanges, 30 * 1000);

  // set up periodic recompute based on user preferences
  scheduleRecomputeFromPrefs();

  // perform initial ranking
  recompute(true);
};

// ---------- helper functions ----------
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

// Shorten a long research title for display...
function shortTitle(title){
  if (!title) return '';
  const words = String(title).split(/\s+/);
  return words.length > 8 ? words.slice(0,8).join(' ') + '…' : title;
}

// ---------- wearable data ----------
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

// ---------- recompute schedule based on user preferences ----------
function scheduleRecomputeFromPrefs(){
  if(state.recomputeTimer) clearInterval(state.recomputeTimer);
  const prefs = JSON.parse(localStorage.getItem('prefs') || '{}');
  const minutes = (typeof prefs.updateInterval === 'number') ? prefs.updateInterval : 60;
  if(minutes > 0){ state.recomputeTimer = setInterval(() => recompute(true), minutes * 60 * 1000); }
}

// ---------- ranking ----------
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

  // base on preference model
  tags.forEach(t => s += (state.model[t] || 0));

  // NEW: Strong boost for dishes matching LLM-generated profile tags
  const profileTags = state.profileTags?.tags || [];
  tags.forEach(tag => {
    if (profileTags.includes(tag)) {
      s += 12;
    }
  });

  // Reduce score for dishes that conflict with medical flags
  const medicalFlags = state.profileTags?.medical_flags || [];
  if (medicalFlags.includes('high-bp') || medicalFlags.includes('elevated-bp')) {
    if (!tags.includes('low-sodium') && tags.includes('high-sodium')) {
      s -= 8;
    }
  }
  if (medicalFlags.includes('low-activity')) {
    if (!tags.includes('light-clean') && !tags.includes('low-calorie')) {
      s -= 4;
    }
  }

  // adjust for current vitals (keep existing heuristics as backup)
  if((w.caloriesBurned||0) > 400 && tags.includes('high-protein-snack')) s += 8;
  if(((w.bpSystolic||0) >= 130 || (w.bpDiastolic||0) >= 80) && tags.includes('low-sodium')) s += 10;
  if(((w.analysis?.activityLevel||'').toLowerCase()) === 'low' && tags.includes('light-clean')) s += 6;

  // novelty factor
  s += Math.random() * 1.5;

  // bandit learning
  tags.forEach(tag => {
    const stats = state.tagStats[tag] || { shown: 0, success: 0 };
    const banditScore = (stats.success + 1) / (stats.shown + 2);
    s += banditScore * 4;
  });

  if (item.llmScore != null) {
    s += (item.llmScore * 2);
  }

  return s;
}

// -----------------------------------------------------------------------------
// fetchLlmScores
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

// ---------- render cards ----------
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
  let searchUrl;
  if (item.link) {
    searchUrl = item.link;
  } else {
    const q = `${item.title} healthy Bangalore`;
    searchUrl = `https://www.swiggy.com/search?q=${encodeURIComponent(q)}`;
  }
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
      ${item.vendorName ? `<div class="muted small mt4">🏪 ${escapeHtml(item.vendorName)}${item.price ? ` • ₹${item.price}` : ''}${item.location ? ` • ${escapeHtml(item.location.split('/')[1] || item.location.split('/')[0])}` : ''}</div>` : ''}
      <div class="row gap8 mt6">
        <button class="pill ghost" id="why-${id}">ℹ Why?</button>
        <button class="pill ghost" id="review-${id}" title="Human review">👩‍⚕️ Review</button>
        <a class="pill" href="${searchUrl}" target="_blank" rel="noopener">🛒 Order Now</a>
      </div>
      <div class="whybox" id="whybox-${id}" hidden></div>
    </li>`;
}

// (all remaining functions: buildWhyHtml, toggleWhy, feedback, model store,
// evidence lookup, ensureMacros – unchanged from your version)
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

async function fetchEvidenceForTag(tag){ /* unchanged */ }
async function ensureMacros(item){ /* unchanged */ }
function buildWhyHtml(item){ /* unchanged from your file */ }
function toggleWhy(item){ /* unchanged from your file */ }
function feedback(item, delta){ /* unchanged */ }
function loadModel(){ try{ return JSON.parse(localStorage.getItem('userModel') || '{}'); } catch(_){ return {}; } }
function saveModel(m){ localStorage.setItem('userModel', JSON.stringify(m)); }

})();
