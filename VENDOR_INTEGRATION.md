# Vendor Menu Integration - Technical Documentation

## Overview

This document describes the vendor menu integration and LLM-driven profile tag system added to the Healthy Diet dashboard.

## Architecture

### Data Flow

1. **User Medical Data** → Wearable device (`wearable_stream.json`)
2. **Medical Data + Preferences** → `/api/profile-tags` → **Diet Tags + Medical Flags**
3. **Profile Tags + Location** → `/api/vendor-catalog` → **Filtered Vendor Menu Items**
4. **Vendor Items + Profile Tags** → Scoring Algorithm → **Ranked Recommendations**

### Key Components

#### 1. `/api/profile-tags` (Netlify Function)

**Purpose**: Generate personalized diet tags from user's health metrics using LLM.

**Input**:
```json
{
  "vitals": {
    "heartRate": 82,
    "caloriesBurned": 430,
    "bpSystolic": 138,
    "bpDiastolic": 88,
    "steps": 5230,
    "analysis": { "activityLevel": "Moderate" }
  },
  "preferences": {
    "diet": "veg",
    "satvik": true
  }
}
```

**Output**:
```json
{
  "tags": ["low-sodium", "anti-inflammatory", "high-protein", "satvik"],
  "medical_flags": ["elevated-bp"],
  "reasoning": "Tags selected based on blood pressure management."
}
```

**Fallback Behavior**: 
- If no LLM API key is configured, uses heuristic rules based on vitals
- Always returns 200 status with valid response

#### 2. `/api/vendor-catalog` (Netlify Function)

**Purpose**: Transform raw vendor menu data into enriched catalog with tags and metadata.

**Input**: Query parameters
- `location`: Filter by location (default: "Bangalore")
- `diet`: Filter by diet type ("veg" or "nonveg")
- `tags`: Comma-separated tags to filter by

**Output**: Array of enriched menu items
```json
[
  {
    "id": "healthybee-0",
    "title": "Paneer Sprouts Salad",
    "hero": "Paneer Sprouts",
    "tags": ["high-protein", "low-carb", "light-clean", "low-sodium", "satvik", "high-fiber"],
    "type": "veg",
    "vendorId": "healthybee",
    "vendorName": "Healthybee",
    "location": "Bangalore/HSR Layout",
    "price": 259,
    "link": "https://www.swiggy.com/search?q=..."
  }
]
```

**Tag Generation Logic**:
- `high-protein`: Dish name contains protein-related keywords (chicken, paneer, fish, etc.)
- `low-carb`: Salads, grilled items, non-rice bowls
- `light-clean`: Grilled, salad, smoothie, or price < ₹250
- `low-sodium`: Grilled, steamed, boiled, or salad
- `satvik`: Vegetarian with traditional Indian ingredients (dal, khichdi, rice, chapati)
- `high-fiber`: Brown rice, quinoa, oats, sprouts, chickpea
- `anti-inflammatory`: Turmeric, ginger, greens, berry
- `balanced`: Meal boxes and complete meals

#### 3. Frontend Integration (`app.js`)

**New State Properties**:
```javascript
state.profileTags = {
  tags: [],           // Diet tags from LLM
  medical_flags: [],  // Health concerns
  reasoning: ''       // Brief explanation
}
state.usingVendorCatalog = false  // Track data source
```

**New Functions**:

- `loadVendorCatalog()`: Load vendor menus via `/api/vendor-catalog`
- `fetchProfileTags()`: Get LLM-generated tags via `/api/profile-tags`
- Both called during `APP_BOOT` and when clicking "Get Picks"

**Enhanced Scoring**:

The `scoreItem()` function now includes:
- **+12 points** per profile tag match (strong boost for LLM recommendations)
- **-8 points** for high-sodium dishes when user has elevated BP
- **-4 points** for heavy dishes when user has low activity
- Original heuristics and bandit learning remain unchanged

**UI Updates**:

Cards now display:
```
🏪 Healthybee • ₹259 • HSR Layout
```

Explanations reference profile tags:
```
blood pressure management → low sodium recommended, available from nearby vendor
```

## Configuration

### Environment Variables

Required for LLM functionality (optional - uses heuristics if missing):
- `DEEPSEEK_API_KEY`: DeepSeek API key (preferred)
- `OPENAI_API_KEY`: OpenAI API key (alternative)
- `ACL_API`: Legacy API key name (fallback)

### Location Configuration

Currently simulated:
```javascript
const userLocation = 'Bangalore';  // TODO: Get from GPS or preferences
```

**Future Enhancement**: Fetch actual user location from:
- Browser geolocation API
- User preferences form
- IP-based location lookup

## Testing

### Test Vendor Catalog Endpoint

```bash
node -e "
const handler = require('./netlify/functions/vendor-catalog.js').handler;
handler({ httpMethod: 'GET', queryStringParameters: {} })
  .then(r => console.log(JSON.parse(r.body).length, 'items'))
"
```

### Test Profile Tags Endpoint

```bash
node -e "
const handler = require('./netlify/functions/profile-tags.js').handler;
handler({ 
  httpMethod: 'POST', 
  body: JSON.stringify({
    vitals: { bpSystolic: 138, bpDiastolic: 88, caloriesBurned: 430 },
    preferences: { diet: 'veg', satvik: true }
  })
}).then(r => console.log(JSON.parse(r.body)))
"
```

## Deployment

The application automatically uses vendor menus when:
1. `data/partner_menus.json` exists and is readable
2. `/api/vendor-catalog` function is deployed
3. `/api/profile-tags` function is deployed

If any component fails, the app gracefully falls back to:
- Static `food_catalog.json` for catalog
- Generic recipe API (`/api/recipes`)
- Empty profile tags (no personalization)

## Future Enhancements

### Phase 1: Real-time Location
- [ ] Integrate GPS/browser geolocation
- [ ] Add location preference to user settings
- [ ] Filter vendors by proximity (e.g., within 5km)

### Phase 2: Vendor Integration
- [ ] Add vendor availability schedule (open/closed)
- [ ] Integrate Swiggy/Zomato APIs for real-time menus
- [ ] Add delivery time estimates
- [ ] Support multiple cities

### Phase 3: Enhanced Personalization
- [ ] Track meal history and preferences over time
- [ ] A/B test different tag weights
- [ ] Add nutritionist consultation booking
- [ ] Support custom dietary restrictions (allergies, intolerances)

### Phase 4: Data Quality
- [ ] Add nutrition macros from vendor APIs
- [ ] Validate and improve tag accuracy with user feedback
- [ ] Add dish photos from vendors
- [ ] Implement vendor rating system

## Troubleshooting

**Issue**: No vendor items showing
- Check `data/partner_menus.json` exists
- Verify `/api/vendor-catalog` is deployed
- Check browser console for errors

**Issue**: Generic dishes still appearing
- Vendor catalog may have failed to load (check console)
- App falls back to `food_catalog.json` or recipe API
- Verify network connectivity

**Issue**: Profile tags are empty
- Check if LLM API key is configured (optional)
- Heuristic fallback should still work without API key
- Verify wearable data is loading correctly

## Contact

For questions or issues, see the main repository README or open a GitHub issue.
