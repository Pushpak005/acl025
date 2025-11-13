// Usage: node scripts/csv-to-json.js input.csv "Vendor Name"
// Example: node scripts/csv-to-json.js "Menus list with hotels(all).csv" "Shree Krishna Veg"
const fs = require('fs');
const path = require('path');
const parse = require('csv-parse/lib/sync');

if (process.argv.length < 4) {
  console.error('Usage: node csv-to-json.js <input.csv> <vendor-name>');
  process.exit(1);
}
const input = process.argv[2];
const vendor = process.argv[3];
const csv = fs.readFileSync(input, 'utf8');
const rows = parse(csv, { columns: true, skip_empty_lines: true });

// Normalize rows to items
const items = rows.map(r => {
  const title = (r['Menu Name'] || r['Menu'] || r['Item'] || '').trim();
  const priceRaw = (r['Price'] || '').toString();
  const price = Number(priceRaw.replace(/[^\d.]/g, '')) || 0;
  const description = (r['Description'] || '').trim();
  return {
    title,
    price,
    description,
    vendor: vendor,
    source: 'partnersheet'
  };
}).filter(i => i.title);

const outPath = path.join(__dirname, '..', 'data', 'partner_menus.json');
fs.writeFileSync(outPath, JSON.stringify(items, null, 2));
console.log('Wrote', outPath, '(', items.length, 'items)');
