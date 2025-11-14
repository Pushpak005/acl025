#!/usr/bin/env node

/**
 * Normalize partner_menus.json to include all required fields:
 * - title (from name)
 * - vendor (from hotel)
 * - price
 * - description (generated)
 * - tags (inferred from name)
 * - macros (estimated)
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'partner_menus.json');
const OUTPUT_FILE = INPUT_FILE; // overwrite the same file

// Tag inference rules based on keywords in dish names
const TAG_RULES = {
  'veg': ['veg', 'paneer', 'vegetable', 'palak', 'subz', 'alu', 'gobi', 'dal', 'salad', 'fruit', 'mushroom', 'corn', 'peas', 'cheese'],
  'nonveg': ['chicken', 'fish', 'egg', 'mutton', 'prawns', 'crab', 'surmai', 'pomfret', 'bangda', 'bombil', 'mandeli', 'tisrya'],
  'high-protein-snack': ['protein', 'chicken', 'paneer', 'egg', 'fish', 'prawns', 'tikka', 'grilled', 'tandoor', 'mutton', 'omelette'],
  'low-carb': ['salad', 'grilled', 'tikka', 'tandoor', 'steamed', 'soup', 'egg white'],
  'low-sodium': ['steamed', 'boiled', 'soup', 'clear soup', 'salad'],
  'light-clean': ['salad', 'soup', 'steamed', 'boiled', 'light', 'clear', 'juice', 'smoothie', 'oats'],
  'satvik': ['khichdi', 'dal', 'rice', 'fruit', 'curd', 'yogurt', 'milk']
};

// Macro estimation based on dish types (per 100g approximation)
const MACRO_TEMPLATES = {
  'salad': { kcal: 100, protein_g: 8, carbs_g: 10, fat_g: 3 },
  'protein-rich': { kcal: 250, protein_g: 20, carbs_g: 15, fat_g: 10 },
  'light-meal': { kcal: 180, protein_g: 10, carbs_g: 20, fat_g: 5 },
  'rice-meal': { kcal: 300, protein_g: 12, carbs_g: 50, fat_g: 8 },
  'curry': { kcal: 220, protein_g: 12, carbs_g: 18, fat_g: 12 },
  'biryani': { kcal: 320, protein_g: 15, carbs_g: 45, fat_g: 12 },
  'soup': { kcal: 80, protein_g: 5, carbs_g: 8, fat_g: 2 },
  'sandwich': { kcal: 200, protein_g: 10, carbs_g: 25, fat_g: 6 },
  'wrap': { kcal: 220, protein_g: 12, carbs_g: 28, fat_g: 7 },
  'dessert': { kcal: 180, protein_g: 3, carbs_g: 30, fat_g: 6 },
  'juice': { kcal: 60, protein_g: 1, carbs_g: 14, fat_g: 0 },
  'default': { kcal: 200, protein_g: 10, carbs_g: 25, fat_g: 8 }
};

function inferTags(name) {
  const tags = [];
  const lowerName = name.toLowerCase();
  
  // Determine veg/nonveg first
  let isVeg = false;
  let isNonVeg = false;
  
  for (const keyword of TAG_RULES['nonveg']) {
    if (lowerName.includes(keyword)) {
      isNonVeg = true;
      break;
    }
  }
  
  if (!isNonVeg) {
    for (const keyword of TAG_RULES['veg']) {
      if (lowerName.includes(keyword)) {
        isVeg = true;
        break;
      }
    }
  }
  
  // Add other tags based on keywords
  for (const [tag, keywords] of Object.entries(TAG_RULES)) {
    if (tag === 'veg' || tag === 'nonveg') continue;
    for (const keyword of keywords) {
      if (lowerName.includes(keyword)) {
        tags.push(tag);
        break;
      }
    }
  }
  
  // Remove duplicates
  return [...new Set(tags)];
}

function inferMacros(name) {
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('salad')) {
    return MACRO_TEMPLATES['salad'];
  }
  if (lowerName.includes('protein') || lowerName.includes('tikka') || lowerName.includes('grilled')) {
    return MACRO_TEMPLATES['protein-rich'];
  }
  if (lowerName.includes('soup')) {
    return MACRO_TEMPLATES['soup'];
  }
  if (lowerName.includes('biryani') || lowerName.includes('pulao')) {
    return MACRO_TEMPLATES['biryani'];
  }
  if (lowerName.includes('rice') || lowerName.includes('khichdi')) {
    return MACRO_TEMPLATES['rice-meal'];
  }
  if (lowerName.includes('curry') || lowerName.includes('masala')) {
    return MACRO_TEMPLATES['curry'];
  }
  if (lowerName.includes('sandwich') || lowerName.includes('toast')) {
    return MACRO_TEMPLATES['sandwich'];
  }
  if (lowerName.includes('wrap')) {
    return MACRO_TEMPLATES['wrap'];
  }
  if (lowerName.includes('juice') || lowerName.includes('smoothie') || lowerName.includes('milkshake')) {
    return MACRO_TEMPLATES['juice'];
  }
  if (lowerName.includes('dessert') || lowerName.includes('sweet') || lowerName.includes('kulfi') || lowerName.includes('ice cream')) {
    return MACRO_TEMPLATES['dessert'];
  }
  if (lowerName.includes('oats') || lowerName.includes('light')) {
    return MACRO_TEMPLATES['light-meal'];
  }
  
  return MACRO_TEMPLATES['default'];
}

function generateDescription(name, vendor) {
  // Generate a simple description based on the dish name
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('salad')) {
    return `Fresh ${name.toLowerCase()} from ${vendor}`;
  }
  if (lowerName.includes('meal box') || lowerName.includes('thali')) {
    return `Complete ${name.toLowerCase()} served at ${vendor}`;
  }
  if (lowerName.includes('biryani') || lowerName.includes('pulao')) {
    return `Aromatic ${name.toLowerCase()} prepared by ${vendor}`;
  }
  if (lowerName.includes('tikka') || lowerName.includes('tandoor') || lowerName.includes('grilled')) {
    return `Grilled ${name.toLowerCase()} from ${vendor}`;
  }
  if (lowerName.includes('soup')) {
    return `Warm ${name.toLowerCase()} served at ${vendor}`;
  }
  if (lowerName.includes('juice') || lowerName.includes('smoothie')) {
    return `Fresh ${name.toLowerCase()} from ${vendor}`;
  }
  
  return `Delicious ${name.toLowerCase()} from ${vendor}`;
}

function inferType(name) {
  const lowerName = name.toLowerCase();
  
  for (const keyword of TAG_RULES['nonveg']) {
    if (lowerName.includes(keyword)) {
      return 'nonveg';
    }
  }
  
  return 'veg';
}

function normalizeMenu(item) {
  const vendor = item.hotel || 'Unknown Vendor';
  const title = item.name || item.title || 'Untitled Dish';
  const price = item.price || 0;
  
  const tags = inferTags(title);
  const macros = inferMacros(title);
  const description = generateDescription(title, vendor);
  const type = inferType(title);
  
  return {
    title,
    price,
    description,
    vendor,
    tags,
    macros,
    type
  };
}

function main() {
  try {
    console.log('Reading partner_menus.json...');
    const raw = fs.readFileSync(INPUT_FILE, 'utf8');
    const menus = JSON.parse(raw);
    
    console.log(`Found ${menus.length} menu items`);
    console.log('Normalizing menu items...');
    
    const normalized = menus.map(item => normalizeMenu(item));
    
    console.log('Writing normalized data back to file...');
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(normalized, null, 2), 'utf8');
    
    console.log(`✓ Successfully normalized ${normalized.length} menu items`);
    
    // Print summary
    const vendors = [...new Set(normalized.map(item => item.vendor))];
    console.log(`\nVendors found: ${vendors.length}`);
    vendors.forEach(v => console.log(`  - ${v}`));
    
    console.log('\nSample normalized item:');
    console.log(JSON.stringify(normalized[0], null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { normalizeMenu, inferTags, inferMacros };
