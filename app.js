(() => {
/* Healthy Diet – Vendor-menu build
   - Today’s Picks come only from vendor_menus.json (Healthybee, Swad Gomantak, Shree Krishna Veg).
   - No external recipe API, no /api/vendor-catalog, no location parameter.
   - Wearable + /api/profile-tags drive ranking.
   - Why + evidence + DeepSeek logic kept.
*/

const VENDOR_MENUS_URL = "vendor_menus.json";
const WEARABLE_URL = "wearable_stream.json";
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
// Load partner vendor menus directly from vendor_menus.json
// This ignores location and just aggregates all vendors’ dishes.
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
    if (items.length === 0) {
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
// Profile tags generation (LLM via /api/profile-tags)
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

  // wearable + tags + vendor menus
  await pullWearable();
  await fetchProfileTags();
  await loadVendorMenus();

  // poll wearable
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

  // preference model
  tags.forEach(t => s += (state.model[t] || 0));

  // profile tag boost
  const profileTags = state.profileTags?.tags || [];
  tags.forEach(tag => {
    if (profileTags.includes(tag)) s += 12;
  });

  // medical flags
  const medicalFlags = state.profileTags?.medical_flags || [];
  if (medicalFlags.includes('high-bp') || medicalFlags.includes('elevated-bp')) {
    if (!tags.includes('low-sodium') && tags.includes('high-sodium')) s -= 8;
  }
  if (medicalFlags.includes('low-activity')) {
    if (!tags.includes('light-clean') && !tags.includes('low-calorie')) s -= 4;
  }

  // vitals heuristics
  if((w.caloriesBurned||0) > 400 && tags.includes('high-protein-snack')) s += 8;
  if(((w.bpSystolic||0) >= 130 || (w.bpDiastolic||0) >= 80) && tags.includes('low-sodium')) s += 10;
  if(((w.analysis?.activityLevel||'').toLowerCase()) === 'low' && tags.includes('light-clean')) s += 6;

  // novelty
  s += Math.random() * 1.5;

  // bandit
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
  // For now keep Swiggy search; you can later replace with /order route.
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

// ---------- Why + evidence + DeepSeek ----------
// (reuse your existing buildWhyHtml, toggleWhy, fetchEvidenceForTag, ensureMacros, feedback, model store)
// For brevity, keep those functions as they are in your current file.

function loadModel(){ try{ return JSON.parse(localStorage.getItem('userModel') || '{}'); } catch(_){ return {}; } }
function saveModel(m){ localStorage.setItem('userModel', JSON.stringify(m)); }

})();
