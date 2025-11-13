// netlify/functions/getPartnerMenus.js
const fs = require('fs');
const path = require('path');

exports.handler = async function (event, context) {
  try {
    // Try multiple sensible locations. On Netlify the project root is process.cwd()
    const possible = [
      path.join(process.cwd(), 'data', 'partner_menus.json'),          // most robust on Netlify
      path.join(process.cwd(), 'public', 'data', 'partner_menus.json'),
      path.join(__dirname, '..', 'data', 'partner_menus.json'),
      path.join(__dirname, '..', '..', 'data', 'partner_menus.json'),
      path.join(__dirname, '..', '..', '..', 'data', 'partner_menus.json')
    ];
    const found = possible.find(p => fs.existsSync(p));
    if (!found) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          success: false,
          message: 'partner_menus.json not found in any known location',
          tried: possible
        })
      };
    }

    const raw = fs.readFileSync(found, 'utf8');
    const menus = JSON.parse(raw);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, menus })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: String(err && err.message ? err.message : err) })
    };
  }
};
