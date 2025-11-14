/*
 * vendor-catalog.js – Netlify function to serve vendor menus with enriched metadata
 *
 * This endpoint transforms the raw partner_menus.json data into a catalog format
 * compatible with the app, adding tags, type classification, and location info.
 *
 * Query parameters:
 *   - location: filter by location (e.g., 'Bangalore', 'HSR Layout')
 *   - diet: filter by diet type ('veg' or 'nonveg')
 *   - tags: comma-separated tags to filter by
 *
 * Output: Array of dish objects with structure:
 *   { id, title, hero, tags[], type, vendorId, vendorName, location, price, link }
 */

const fs = require('fs');
const path = require('path');

exports.handler = async function(event) {
  try {
    // Load partner menus from data directory
    const menuPath = path.join(process.cwd(), 'data', 'partner_menus.json');
    if (!fs.existsSync(menuPath)) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Partner menus not found' })
      };
    }

    const rawData = fs.readFileSync(menuPath, 'utf8');
    const rawMenus = JSON.parse(rawData);

    // Query parameters for filtering
    const params = event.queryStringParameters || {};
    const locationFilter = params.location ? params.location.toLowerCase() : null;
    const dietFilter = params.diet ? params.diet.toLowerCase() : null;
    const tagsFilter = params.tags ? params.tags.split(',').map(t => t.trim().toLowerCase()) : null;

    // Transform raw menus into enriched catalog
    const catalog = rawMenus.map((item, index) => {
      const enriched = enrichMenuItem(item, index);
      return enriched;
    });

    // Apply filters
    let filtered = catalog;

    if (locationFilter) {
      filtered = filtered.filter(item => 
        item.location && item.location.toLowerCase().includes(locationFilter)
      );
    }

    if (dietFilter) {
      filtered = filtered.filter(item => item.type === dietFilter);
    }

    if (tagsFilter && tagsFilter.length > 0) {
      filtered = filtered.filter(item => {
        const itemTags = (item.tags || []).map(t => t.toLowerCase());
        return tagsFilter.some(tag => itemTags.includes(tag));
      });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filtered)
    };

  } catch (err) {
    console.error('Error loading vendor catalog:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to load vendor catalog', details: err.message })
    };
  }
};

/**
 * Enrich a menu item with tags, type, and location based on its name and vendor
 */
function enrichMenuItem(item, index) {
  const name = item.name || '';
  const vendor = item.hotel || '';
  const price = item.price || 0;

  // Generate unique ID
  const id = `${slugify(vendor)}-${index}`;

  // Extract hero (short label) from name
  const hero = name.split(' ').slice(0, 2).join(' ');

  // Determine type (veg/nonveg) based on keywords
  const type = classifyDishType(name);

  // Generate tags based on dish name and characteristics
  const tags = generateTags(name, price);

  // TODO: In production, fetch actual location from vendor database
  // For now, simulate Bangalore locations for demo
  const location = 'Bangalore/HSR Layout';

  // Generate ordering link (Swiggy search)
  const link = `https://www.swiggy.com/search?q=${encodeURIComponent(name + ' ' + vendor + ' Bangalore')}`;

  return {
    id,
    title: name,
    hero,
    tags,
    type,
    vendorId: slugify(vendor),
    vendorName: vendor,
    location,
    price,
    link
  };
}

/**
 * Classify dish as veg or nonveg based on name
 */
function classifyDishType(name) {
  const nameLower = name.toLowerCase();
  
  // Non-veg keywords
  const nonVegKeywords = [
    'chicken', 'fish', 'meat', 'beef', 'pork', 'mutton', 'egg',
    'prawn', 'shrimp', 'lamb', 'turkey', 'bacon', 'salmon'
  ];

  for (const keyword of nonVegKeywords) {
    if (nameLower.includes(keyword)) {
      return 'nonveg';
    }
  }

  return 'veg';
}

/**
 * Generate relevant diet tags based on dish name and price
 */
function generateTags(name, price) {
  const nameLower = name.toLowerCase();
  const tags = [];

  // Protein-rich dishes
  if (nameLower.includes('protein') || 
      nameLower.includes('chicken') || 
      nameLower.includes('paneer') ||
      nameLower.includes('fish') ||
      nameLower.includes('chickpea') ||
      nameLower.includes('quinoa') ||
      nameLower.includes('tofu')) {
    tags.push('high-protein');
  }

  // Low-carb dishes
  if (nameLower.includes('salad') || 
      nameLower.includes('grilled') ||
      nameLower.includes('tikka') ||
      (nameLower.includes('bowl') && !nameLower.includes('rice'))) {
    tags.push('low-carb');
  }

  // Light/clean meals
  if (nameLower.includes('salad') || 
      nameLower.includes('soup') ||
      nameLower.includes('smoothie') ||
      nameLower.includes('grilled') ||
      price < 250) {
    tags.push('light-clean');
  }

  // Low-sodium (approximate based on preparation)
  if (nameLower.includes('grilled') || 
      nameLower.includes('steamed') ||
      nameLower.includes('boiled') ||
      nameLower.includes('salad')) {
    tags.push('low-sodium');
  }

  // Satvik dishes (vegetarian, simple ingredients)
  if (!nameLower.includes('chicken') && 
      !nameLower.includes('fish') && 
      !nameLower.includes('meat') &&
      !nameLower.includes('egg') &&
      (nameLower.includes('dal') || 
       nameLower.includes('khichdi') ||
       nameLower.includes('rice') ||
       nameLower.includes('chapati') ||
       nameLower.includes('sprouts'))) {
    tags.push('satvik');
  }

  // High-fiber
  if (nameLower.includes('brown rice') || 
      nameLower.includes('quinoa') ||
      nameLower.includes('oats') ||
      nameLower.includes('sprouts') ||
      nameLower.includes('chickpea')) {
    tags.push('high-fiber');
  }

  // Anti-inflammatory
  if (nameLower.includes('turmeric') || 
      nameLower.includes('ginger') ||
      nameLower.includes('greens') ||
      nameLower.includes('berry') ||
      nameLower.includes('salmon')) {
    tags.push('anti-inflammatory');
  }

  // Balanced meals
  if (nameLower.includes('meal box') || 
      nameLower.includes('meal') ||
      nameLower.includes('bowl')) {
    tags.push('balanced');
  }

  // Add at least one tag if none were matched
  if (tags.length === 0) {
    tags.push('balanced');
  }

  return tags;
}

/**
 * Convert string to URL-friendly slug
 */
function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
