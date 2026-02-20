#!/usr/bin/env node
/**
 * Clalit Pharmacy Stock Search
 * Searches medications and checks real-time stock at Clalit pharmacies in Israel.
 */

const SEARCH_BASE = 'https://e-services.clalit.co.il/PharmacyStockCoreAPI/Search';
const STOCK_BASE = 'https://e-services.clalit.co.il/PharmacyStockCoreAPI/api/PharmacyStock';
const PHARMACY_STOCK_URL = 'https://e-services.clalit.co.il/PharmacyStock/';
const LANG = 'he-il';

// ── Shared utilities ──────────────────────────────────────────────────────────

function encodeSearchText(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function searchPost(path, body) {
  const url = `${SEARCH_BASE}/${path}?lang=${LANG}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Search API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ── Stock check via Puppeteer (WAF-protected endpoints) ───────────────────────

async function stockPost(endpoint, body) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(PHARMACY_STOCK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const url = `${STOCK_BASE}/${endpoint}?lang=${LANG}`;
    const result = await page.evaluate(async (reqUrl, reqBody) => {
      const res = await fetch(reqUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Recaptcha-Client-Token': '',
        },
        body: JSON.stringify(reqBody),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`WAF_BLOCKED:${res.status}`);
      }
      return res.json();
    }, url, body);

    return result;
  } finally {
    await browser.close();
  }
}

// ── Status label mapping ──────────────────────────────────────────────────────

const STATUS_LABELS = {
  30: 'במלאי',
  20: 'מלאי מוגבל',
  0: 'אין במלאי',
  10: 'אין מידע',
};

function stockLabel(code) {
  return STATUS_LABELS[code] ?? `קוד ${code}`;
}

// ── Command: search ───────────────────────────────────────────────────────────

async function cmdSearch(args) {
  const query = args.join(' ').trim();
  if (!query) {
    console.error('Usage: search <medication name>');
    process.exit(1);
  }
  const results = await searchPost('GetFilterefMedicationsList', {
    searchText: encodeSearchText(query),
    isPrefix: true,
  });
  if (!results || results.length === 0) {
    console.log(`No medications found for "${query}"`);
    return;
  }
  console.log(`Found ${results.length} medication(s) for "${query}":\n`);
  for (const med of results) {
    console.log(`  ${med.catCode} | ${med.omryName}`);
  }
}

// ── Command: pharmacies ───────────────────────────────────────────────────────

async function cmdPharmacies(args) {
  const query = args.join(' ').trim();
  if (!query) {
    console.error('Usage: pharmacies <pharmacy name>');
    process.exit(1);
  }
  const results = await searchPost('GetFilterefPharmaciesList', {
    searchText: encodeSearchText(query),
    isPrefix: false,
  });
  if (!results || results.length === 0) {
    console.log(`No pharmacies found for "${query}"`);
    return;
  }
  console.log(`Found ${results.length} pharmacy branch(es) for "${query}":\n`);
  for (const ph of results) {
    console.log(`  ${ph.deptCode} | ${ph.deptName}`);
  }
}

// ── Command: cities ───────────────────────────────────────────────────────────

async function cmdCities(args) {
  const filterQuery = args.join(' ').trim().toLowerCase();
  const results = await searchPost('GetAllCitiesList', {});
  if (!results || results.length === 0) {
    console.log('No cities returned from API');
    return;
  }
  const filtered = filterQuery
    ? results.filter(c => c.cityName.toLowerCase().includes(filterQuery))
    : results;

  if (filtered.length === 0) {
    console.log(`No cities matched "${filterQuery}"`);
    return;
  }
  const label = filterQuery ? `${filtered.length} cities matching "${filterQuery}"` : `${filtered.length} cities`;
  console.log(`${label}:\n`);
  for (const city of filtered) {
    console.log(`  ${city.cityCode} | ${city.cityName}`);
  }
}

// ── Command: stock ────────────────────────────────────────────────────────────

function parseStockArgs(args) {
  const catCodes = [];
  let cityCode = null;
  let pharmacyCode = null;
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--city' && args[i + 1]) {
      cityCode = Number(args[i + 1]);
      i += 2;
    } else if (args[i] === '--pharmacy' && args[i + 1]) {
      pharmacyCode = Number(args[i + 1]);
      i += 2;
    } else {
      const n = Number(args[i]);
      if (!isNaN(n) && args[i] !== '') catCodes.push(n);
      i++;
    }
  }
  return { catCodes, cityCode, pharmacyCode };
}

async function resolveOmryNames(catCodes) {
  // Resolve display names for catCodes by fetching from catalog search.
  // We use a dummy search to get the full catalog list and find the names.
  // Fallback: use the catCode as the name string if not found.
  const nameMap = new Map();
  for (const code of catCodes) {
    nameMap.set(code, String(code));
  }

  // Try to resolve each code by searching for its numeric string
  for (const code of catCodes) {
    try {
      const results = await searchPost('GetFilterefMedicationsList', {
        searchText: encodeSearchText(String(code)),
        isPrefix: false,
      });
      const match = results?.find(m => m.catCode === code);
      if (match) nameMap.set(code, match.omryName);
    } catch {
      // silently fall back to code string
    }
  }
  return nameMap;
}

function printStockResults(data, catCodes) {
  if (!data || data.isEmptyResult || !data.pharmaciesList || data.pharmaciesList.length === 0) {
    console.log('No pharmacies found for this search.');
    return;
  }
  for (const ph of data.pharmaciesList) {
    const openStatus = ph.ifOpenedNow ? 'פתוח' : 'סגור';
    console.log(`\n📍 ${ph.pharmacyName}`);
    console.log(`   ${ph.pharmacyAdress || ''}`);
    if (ph.pharmacyPhone) console.log(`   📞 ${ph.pharmacyPhone}`);
    console.log(`   🕐 ${openStatus}`);
    if (ph.medicationsList && ph.medicationsList.length > 0) {
      for (const med of ph.medicationsList) {
        const label = stockLabel(med.kodStatusMlay);
        console.log(`   💊 ${med.medicationName}: ${label}`);
      }
    }
  }
  console.log(`\nTotal: ${data.pharmaciesList.length} pharmacy branch(es)`);
}

async function cmdStock(args) {
  const { catCodes, cityCode, pharmacyCode } = parseStockArgs(args);

  if (catCodes.length === 0) {
    console.error('Usage: stock <catCode> [catCode2 ...] --city <cityCode>');
    console.error('       stock <catCode> [catCode2 ...] --pharmacy <deptCode>');
    process.exit(1);
  }
  if (!cityCode && !pharmacyCode) {
    console.error('Error: provide --city <cityCode> or --pharmacy <deptCode>');
    process.exit(1);
  }

  console.log('Resolving medication names...');
  const nameMap = await resolveOmryNames(catCodes);
  const medicationsList = catCodes.map(code => ({
    catCode: code,
    omryName: nameMap.get(code) ?? String(code),
  }));

  console.log('Launching browser for stock check...');
  try {
    let data;
    if (cityCode) {
      data = await stockPost('GetPharmacyStockByCityCode', {
        medicationsList,
        cityCode,
        UserSystem: 3,
        isGPSActive: false,
      });
    } else {
      data = await stockPost('GetPharmacyStockByPharmacyCode', {
        medicationsList,
        pharmacyCode,
        UserSystem: 3,
        isGPSActive: false,
      });
    }
    if (data.isWsError) {
      console.error('Stock API returned an error. Please try again later.');
      process.exit(1);
    }
    printStockResults(data, catCodes);
  } catch (err) {
    if (err.message?.startsWith('WAF_BLOCKED')) {
      console.error('Request was blocked by Clalit WAF. The stock check requires a browser session.');
      console.error('This may happen if Clalit has updated their security policy.');
    } else {
      console.error(`Stock check failed: ${err.message}`);
    }
    process.exit(1);
  }
}

// ── Command: test ─────────────────────────────────────────────────────────────

async function cmdTest() {
  let passed = 0;
  let failed = 0;

  async function check(label, fn) {
    try {
      await fn();
      console.log(`  ✓ ${label}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${label}: ${err.message}`);
      failed++;
    }
  }

  console.log('Running smoke tests...\n');

  await check('search "amoxicillin" returns results', async () => {
    const results = await searchPost('GetFilterefMedicationsList', {
      searchText: encodeSearchText('amoxicillin'),
      isPrefix: true,
    });
    if (!results || results.length === 0) throw new Error('No results returned');
    if (!results[0].catCode) throw new Error('Missing catCode in result');
  });

  await check('cities "תל" returns Tel Aviv area cities', async () => {
    const results = await searchPost('GetAllCitiesList', {});
    if (!results || results.length === 0) throw new Error('No cities returned');
    const filtered = results.filter(c => c.cityName.includes('תל'));
    if (filtered.length === 0) throw new Error('No תל cities found');
  });

  await check('pharmacies "אסותא" returns results', async () => {
    const results = await searchPost('GetFilterefPharmaciesList', {
      searchText: encodeSearchText('אסותא'),
      isPrefix: false,
    });
    if (!results || results.length === 0) throw new Error('No results returned');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

const [,, command, ...rest] = process.argv;

try {
  switch (command) {
    case 'search':
      await cmdSearch(rest);
      break;
    case 'pharmacies':
      await cmdPharmacies(rest);
      break;
    case 'cities':
      await cmdCities(rest);
      break;
    case 'stock':
      await cmdStock(rest);
      break;
    case 'test':
      await cmdTest();
      break;
    default:
      console.log('Clalit Pharmacy Stock Search\n');
      console.log('Commands:');
      console.log('  search <query>                        Search medications by name');
      console.log('  pharmacies <query>                    Search pharmacy branches by name');
      console.log('  cities [query]                        List cities (optional filter)');
      console.log('  stock <catCode...> --city <cityCode>  Check stock by city');
      console.log('  stock <catCode...> --pharmacy <code>  Check stock by pharmacy branch');
      console.log('  test                                  Run connectivity smoke tests');
      console.log('\nWorkflow:');
      console.log('  1. node scripts/pharmacy-search.js search "amoxicillin"  → get catCode');
      console.log('  2. node scripts/pharmacy-search.js cities "תל אביב"     → get cityCode');
      console.log('  3. node scripts/pharmacy-search.js stock <catCode> --city <cityCode>');
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
