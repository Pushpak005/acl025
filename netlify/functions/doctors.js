// Use the global fetch API available in Node 18 environments.  No import needed.

// doctors.js - Netlify function to fetch healthcare providers
//
// This function uses the BetterDoctor API to find doctors by specialty and
// location.  It expects an API key provided via the DOCTOR_API_KEY
// environment variable.  The request can specify `specialty` (the UID of the
// specialty, e.g. 'nutritionist-dietitian') and `location` (city, state or
// latitude,longitude,radius).  The response is simplified to include the
// doctor name, specialty, practice name, phone, website and address.

exports.handler = async function(event) {
  const apiKey = process.env.DOCTOR_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: 'Missing DOCTOR_API_KEY environment variable' };
  }
  const params = event.queryStringParameters || {};
  // BetterDoctor uses specialty UIDs, but for convenience we allow a string and
  // fallback to nutritionist-dietitian
  const specialty = params.specialty || 'nutritionist-dietitian';
  // Location can be a city name (e.g. 'bangalore'), a state abbreviation or
  // coordinates in the form latitude,longitude,radius (e.g. '37.773,-122.413,100').
  const location = params.location || 'bangalore';
  const limit = params.limit || 10;
  try {
    const query = new URLSearchParams({
      specialty_uid: specialty,
      location,
      limit,
      user_key: apiKey
    }).toString();
    const url = `https://api.betterdoctor.com/2016-03-01/doctors?${query}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      return { statusCode: resp.status, body: `Doctor API error: ${resp.status}` };
    }
    const data = await resp.json();
    if (!data || !Array.isArray(data.data)) {
      return { statusCode: 200, body: JSON.stringify([]) };
    }
    const docs = data.data.map(doc => {
      const name = [doc.profile.first_name, doc.profile.last_name].filter(Boolean).join(' ');
      const specialtyNames = (doc.specialties || []).map(s => s.name).join(', ');
      const practice = (doc.practices && doc.practices[0]) || {};
      const phone = practice.phones && practice.phones[0] ? practice.phones[0].number : null;
      const website = practice.website || null;
      const addr = practice.visit_address || {};
      const address = [addr.street, addr.city, addr.state].filter(Boolean).join(', ');
      return {
        name,
        specialty: specialtyNames,
        practice: practice.name || '',
        phone,
        website,
        address
      };
    });
    return { statusCode: 200, body: JSON.stringify(docs) };
  } catch (e) {
    return { statusCode: 500, body: String(e) };
  }
};