# Partner Menus Management

This document explains how to manage partner menu data for the Today's Picks feature.

## Overview

The app now sources all menu recommendations from `data/partner_menus.json` instead of external APIs. This ensures consistent, reliable menu data from trusted partner vendors.

## Partner Vendors

The allowed partner vendors are configured in `app.js`:

```javascript
window.PARTNER_VENDORS = ["Healthybee", "Swad Gomantak", "shree krishna veg menues"];
```

### Adding or Removing Partners

1. Edit the `window.PARTNER_VENDORS` array in `app.js`
2. Add or remove vendor names (must match the `vendor` field in partner_menus.json)
3. Commit and deploy the changes

## Menu Data Structure

Each menu item in `data/partner_menus.json` must have the following fields:

```json
{
  "title": "Paneer Tikka",
  "price": 120,
  "description": "Grilled paneer with spices",
  "vendor": "Shree Krishna Veg",
  "tags": ["veg", "protein-rich"],
  "macros": {
    "kcal": 250,
    "protein_g": 15,
    "carbs_g": 12,
    "fat_g": 10
  },
  "type": "veg"
}
```

### Required Fields

- `title` (string): Name of the dish
- `price` (number): Price in rupees
- `description` (string): Brief description of the dish
- `vendor` (string): Name of the partner vendor
- `tags` (array): Tags for filtering (e.g., "veg", "high-protein-snack", "low-sodium")
- `macros` (object): Nutritional information per 100g
  - `kcal` (number): Calories
  - `protein_g` (number): Protein in grams
  - `carbs_g` (number): Carbohydrates in grams
  - `fat_g` (number): Fat in grams
- `type` (string): Either "veg" or "nonveg"

## Normalization Script

The normalization script (`scripts/normalize-partner-menus.js`) transforms raw partner data into the required format.

### Running the Normalization Script

If you have partner menu data in the format `{hotel, name, price}`:

```bash
node scripts/normalize-partner-menus.js
```

This will:
1. Read `data/partner_menus.json`
2. Transform each item to include all required fields
3. Infer tags based on dish name keywords
4. Estimate macros based on dish type
5. Generate descriptions
6. Overwrite `data/partner_menus.json` with normalized data

### Tag Inference Rules

Tags are automatically inferred from dish names:

- **veg**: paneer, vegetable, palak, dal, salad, fruit, mushroom, corn
- **nonveg**: chicken, fish, egg, mutton, prawns, crab
- **high-protein-snack**: protein, chicken, paneer, egg, fish, tikka, grilled
- **low-carb**: salad, grilled, tikka, steamed, soup
- **low-sodium**: steamed, boiled, soup, clear soup, salad
- **light-clean**: salad, soup, steamed, light, juice, smoothie
- **satvik**: khichdi, dal, rice, fruit, curd, yogurt, milk

### Macro Templates

Macros are estimated based on dish type (per 100g):

- **salad**: 100 kcal, 8g protein, 10g carbs, 3g fat
- **protein-rich**: 250 kcal, 20g protein, 15g carbs, 10g fat
- **light-meal**: 180 kcal, 10g protein, 20g carbs, 5g fat
- **rice-meal**: 300 kcal, 12g protein, 50g carbs, 8g fat
- **curry**: 220 kcal, 12g protein, 18g carbs, 12g fat
- **biryani**: 320 kcal, 15g protein, 45g carbs, 12g fat
- **soup**: 80 kcal, 5g protein, 8g carbs, 2g fat
- **sandwich**: 200 kcal, 10g protein, 25g carbs, 6g fat
- **wrap**: 220 kcal, 12g protein, 28g carbs, 7g fat
- **dessert**: 180 kcal, 3g protein, 30g carbs, 6g fat
- **juice**: 60 kcal, 1g protein, 14g carbs, 0g fat

## Adding New Menu Data

### Option 1: Manual Entry

Add items directly to `data/partner_menus.json` with all required fields.

### Option 2: Using the Normalization Script

1. Replace the contents of `data/partner_menus.json` with raw data in format:
   ```json
   [
     {"hotel": "Vendor Name", "name": "Dish Name", "price": 100},
     ...
   ]
   ```

2. Run the normalization script:
   ```bash
   node scripts/normalize-partner-menus.js
   ```

3. Verify the output and commit the changes

## Deduplication

The `loadPartnerMenus()` function automatically deduplicates menu items by title (case-insensitive). If multiple items have the same title, only the first one is kept.

## Filtering

Menu items are filtered based on:

1. **Vendor filtering**: Only items from vendors in `window.PARTNER_VENDORS`
2. **Diet preferences**: User's veg/nonveg preference (stored in localStorage)
3. **Deduplication**: By title (case-insensitive)

## Testing

After making changes to partner menu data:

1. Verify the JSON is valid:
   ```bash
   cat data/partner_menus.json | jq '.[0]'
   ```

2. Check vendor names:
   ```bash
   cat data/partner_menus.json | jq '[.[].vendor] | unique'
   ```

3. Test the API function:
   ```bash
   node -e "require('./netlify/functions/getPartnerMenus.js').handler({}, {}).then(r => console.log(JSON.parse(r.body).success))"
   ```

4. Deploy and test in the live app

## Current Stats

- **Total menu items**: 455
- **Vendors**: 3 (Healthybee, Swad Gomantak, shree krishna veg menues)
- **Items with tags**: 245 (54%)
- **Items with macros**: 455 (100%)
