(() => {
/* Healthy Diet – Enhanced Build (light theme)
   (unchanged header comments)
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
  evidenceCache: loadCache("evidenceCache")
};

// ----------------- PARTNER MENUS LOADER -----------------
// Loads partner_menus either via Netlify function or static JSON
// Normalizes partner menu items into the internal recipe shape used by the app:
// { title, hero, link, tags:[], macros:null, price, hotel }
async function loadPartnerMenus() {
  try {
    // try Netlify function first
    const resp = await fetch('/.netlify/functions/getPartnerMenus');
    if (resp.ok) {
      const js = await resp.json();
      if (js && js.success && Array.isArray(js.menus)) {
        return js.menus.map((m, idx) => ({
          title: String(m.name || m.title || '').trim(),
          hero: String(m.name || m.title || '').trim(),
          link: (m.link || `https://www.swiggy.com/search?q=${encodeURIComponent((m.name || '').trim() + ' ' + (m.hotel || ''))}`),
          tags: m.tags || [], // optional if your partner JSON has tags
          macros: m.macros || null,
          price: m.price || '',
          hotel: m.hotel || '',
          id: 'p_' + idx
        })).filter(it => it.title && it.title.length > 0);
      }
    }
    // fallback to static JSON file served as /data/partner_menus.json
    const resp2 = await fetch('/data/partner_menus.json');
    if (resp2.ok) {
      const arr = await resp2.json();
      return arr.map((m, idx) => ({
        title: String(m.name || m.title || '').trim(),
        hero: String(m.name || m.title || '').trim(),
        link: (m.link || `https://www.swiggy.com/search?q=${encodeURIComponent((m.name || '').trim() + ' ' + (m.hotel || ''))}`),
        tags: m.tags || [],
        macros: m.macros || null,
        price: m.price || '',
        hotel: m.hotel || '',
        id: 'p_' + idx
      })).filter(it => it.title && it.title.length > 0);
    }
    return [];
  } catch (e) {
    console.error('Failed to load partner menus:', e);
    return [];
  }
}
// Expose promise so other code can wait for menus to be ready
window.__partnerMenusReady = loadPartnerMenus().then(items => {
  window.PARTNER_CATALOG = items;
  // set window.CATALOG only if nothing else sets it so we don't accidentally override
  if (!window.CATALOG) window.CATALOG = items;
  console.info('Partner menus loaded:', items.length);
  return items;
}).catch(err => {
  console.error('Partner menus failed to load', err);
  return [];
});

// -----------------------------------------------------------------------------
// Recipe loading (modified)
//
// REPLACED behavior: instead of calling external recipe API, we now use ONLY
// the partner menus as the catalog. This ensures recommendations come strictly
// from your hotel partners.
async function loadRecipes() {
  try {
    // Wait for partner menus to be ready
    const partner = await window.__partnerMenusReady;
    if (Array.isArray(partner) && partner.length > 0) {
      // Use partner menus as the catalog
      state.catalog = partner;
      // Optionally, fetch LLM scores for each item (this step is preserved
      // from original behaviour). If you don't want to call the LLM for
      // each partner item, you can skip this to reduce API calls.
      try {
        await fetchLlmScores(state.catalog);
      } catch (_e) {
        console.warn('LLM scoring failed (partner menus)', _e);
      }
      return;
    }
  } catch (e) {
    console.warn('Partner menu load failed inside loadRecipes', e);
  }
  // If partner menus are not available, fall back to the static catalog file
  try {
    const fallback = await safeJson(CATALOG_URL, []);
    if (Array.isArray(fallback) && fallback.length) {
      state.catalog = fallback;
      await fetchLlmScores(state.catalog);
    }
  } catch (e) {
    console.warn('Failed to load fallback catalog', e);
  }
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
    // Fetch a fresh set of recipes (partner menus).  This will re-load partner
    // menus and recompute rankings.
    await loadRecipes();
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

  // Load partner menus as the primary catalog (replaces external recipe fetch)
  await loadRecipes();

  // initial wearable read and polling
  await pullWearable();
  // Poll the wearable file less frequently to allow simulated changes to
  // persist.  Rather than refreshing every 60 seconds (which would reset
  // the vitals to the static demo values and reduce variability), fetch
  // the wearable data every 15 minutes.  In production this would be
  // replaced with real-time integration or a configurable interval.
  state.wearableTimer = setInterval(pullWearable, 15 * 60 * 1000);

  // For demonstration purposes, simulate changing vitals every 30 seconds.  This
  // creates variation in the picks and explanations during development.  In
  // production you may increase this to 15 minutes or remove it entirely if
  // real wearable integration is used.
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
    recompute();
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

// Shorten a long research title for display.  If the title has more than
// eight words, return the first eight words followed by an ellipsis.  This
// helps keep the evidence and AI reason text concise and easy to read.
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
  // show or hide the risk banner based on high-risk vitals
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
    // partner items may not have `type` or tags; be permissive
    if(prefs.diet === 'veg' && item.type && item.type !== 'veg') return false;
    if(prefs.diet === 'nonveg' && item.type && item.type !== 'nonveg') return false;
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
  // adjust for current vitals
  if((w.caloriesBurned||0) > 400 && tags.includes('high-protein-snack')) s += 8;
  if(((w.bpSystolic||0) >= 130 || (w.bpDiastolic||0) >= 80) && tags.includes('low-sodium')) s += 10;
  if(((w.analysis?.activityLevel||'').toLowerCase()) === 'low' && tags.includes('light-clean')) s += 6;
  // novelty factor
  s += Math.random() * 1.5;
  // bandit learning: favour tags that were liked in the past
  tags.forEach(tag => {
    const stats = state.tagStats[tag] || { shown: 0, success: 0 };
    const banditScore = (stats.success + 1) / (stats.shown + 2);
    s += banditScore * 4;
  });
  // incorporate LLM suitability score if available.
  if (item.llmScore != null) {
    s += (item.llmScore * 2);
  }
  return s;
}

// -----------------------------------------------------------------------------
// fetchLlmScores
// (unchanged)
async function fetchLlmScores(recipes) {
  const w = state.wearable || {};
  for (const item of recipes) {
    try {
      const resp = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vitals: w, macros: item.macros || {}, tags: item.tags || [], title: item.title || item.name || '' })
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
  // fetch macros for each dish in parallel
  await Promise.all(slice.map(({ item }) => ensureMacros(item)));
  // update bandit shown counts
  slice.forEach(({ item }) => {
    (item.tags || []).forEach(t => {
      if(!state.tagStats[t]) state.tagStats[t] = { shown: 0, success: 0 };
      state.tagStats[t].shown += 1;
    });
  });
  saveCache('tagStats', state.tagStats);
  // render HTML
  el.innerHTML = slice.map(({ item }) => cardHtml(item)).join('');
  slice.forEach(({ item }) => {
    const id = slug(item.title || item.name || '');
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
  const id = slug(item.title || item.name || '');
  let searchUrl;
  if (item.link) {
    searchUrl = item.link;
  } else {
    const q = `${item.title || item.name} healthy Bangalore`;
    searchUrl = `https://www.swiggy.com/search?q=${encodeURIComponent(q)}`;
  }
  // Include hotel name & price in card to confirm partner source
  const hotelLine = item.hotel ? `<div class="muted small">From: ${escapeHtml(item.hotel)} • ₹${escapeHtml(item.price || '')}</div>` : '';
  return `
    <li class="card">
      <div class="tile">${escapeHtml(item.hero || item.title || item.name)}</div>
      <div class="row-between mt8">
        <h4>${escapeHtml(item.title || item.name)}</h4>
        <div class="btn-group">
          <button class="chip" id="like-${id}" title="Like">♥</button>
          <button class="chip" id="skip-${id}" title="Skip">⨯</button>
        </div>
      </div>
      ${hotelLine}
      <div class="row gap8 mt6">
        <button class="pill ghost" id="why-${id}">ℹ Why?</button>
        <button class="pill ghost" id="review-${id}" title="Human review">👩‍⚕️ Review</button>
        <a class="pill" href="${searchUrl}" target="_blank" rel="noopener">🛒 Order Now</a>
      </div>
      <div class="whybox" id="whybox-${id}" hidden></div>
    </li>`;
}

// (the rest of the file remains unchanged and kept as-is — all functions below operate unchanged)
... (rest of original app.js continues unchanged) ...
})();
