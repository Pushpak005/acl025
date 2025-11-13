(() => {
  // Load the dish to be reviewed from sessionStorage
  const dish = sessionStorage.getItem('reviewItem') ? JSON.parse(sessionStorage.getItem('reviewItem')) : null;
  const reviewDishEl = document.getElementById('reviewDish');
  if (dish) {
    reviewDishEl.innerHTML = `<b>Reviewing:</b> ${sanitize(dish.title)}`;
  } else {
    reviewDishEl.textContent = '';
  }

  // Fetch a dynamic list of nutritionists/doctors via the serverless function.
  // The API returns a list of providers with names, specialties, practice details
  // and contact information.  The query parameters can be customised per region
  // or specialty if desired.
  async function loadNutritionists() {
    try {
      const params = new URLSearchParams({
        specialty: 'nutritionist-dietitian',
        location: 'bangalore'
      }).toString();
      const resp = await fetch('/api/doctors?' + params);
      if (!resp.ok) throw new Error('Failed to load');
      const list = await resp.json();
      renderList(Array.isArray(list) ? list : []);
    } catch (e) {
      console.warn('Error loading nutritionists', e);
    }
  }

  function renderList(list) {
    const ul = document.getElementById('reviewList');
    if (!ul) return;
    ul.innerHTML = list.map(item => renderItem(item)).join('');
  }

  function renderItem(item) {
    // Each doctor entry has { name, specialty, practice, phone, website, address }
    const name = sanitize(item.name || 'Doctor');
    const speciality = sanitize(item.specialty || '');
    const practice = sanitize(item.practice || '');
    const location = sanitize(item.address || '');
    const phoneLink = item.phone ? `<a class="pill" href="tel:${sanitize(item.phone)}">Call</a>` : '';
    const websiteLink = item.website ? `<a class="pill" href="${sanitize(item.website)}" target="_blank" rel="noopener">Website</a>` : '';
    return `<li class="card">
      <h4>${name}</h4>
      <p class="muted small" style="margin-top:4px">${speciality}${practice ? (' • ' + practice) : ''}</p>
      <p class="muted small" style="margin-top:4px">${location}</p>
      <div class="row gap8 mt8">
        ${phoneLink}
        ${websiteLink}
      </div>
    </li>`;
  }

  function sanitize(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Back button
  document.getElementById('backBtn')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  // Kick off load
  loadNutritionists();
})();