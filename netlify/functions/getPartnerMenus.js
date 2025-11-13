// netlify/functions/getPartnerMenus.js
const fs = require('fs');
const path = require('path');

exports.handler = async function (event, context) {
  try {
    const possible = [
      path.join(__dirname, '..', '..', 'data', 'partner_menus.json'),
      path.join(__dirname, '..', 'data', 'partner_menus.json'),
      path.join(__dirname, '..', '..', '..', 'data', 'partner_menus.json')
    ];
    let p = possible.find(pp => fs.existsSync(pp));
    if (!p) {
      return { statusCode: 404, body: JSON.stringify({ success:false, message:'partner_menus.json not found', tried: possible }) };
    }
    const raw = fs.readFileSync(p, 'utf8');
    const menus = JSON.parse(raw);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success:true, menus }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success:false, message: err.message }) };
  }
};
