#!/usr/bin/env node
/**
 * Clalit Pharmacy Stock Search
 * Searches medications and checks real-time stock at Clalit pharmacies in Israel.
 */

const SEARCH_BASE = 'https://e-services.clalit.co.il/PharmacyStockCoreAPI/Search';
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
  if (!res.ok) throw new Error(`Search API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// Scan results for a matching item by searching short prefixes until found.
// Used for both medication (a-z) and pharmacy (Hebrew letters) reverse-lookup,
// since the Search API is text-only and doesn't support lookup by numeric code.
async function findByPrefix(apiPath, prefixes, isPrefix, matchFn) {
  for (const prefix of prefixes) {
    const results = await searchPost(apiPath, {
      searchText: encodeSearchText(prefix),
      isPrefix,
    }).catch(() => null);
    const match = results?.find(matchFn);
    if (match) return match;
  }
  return null;
}

// ── Stock check via Puppeteer UI interaction (WAF-protected endpoints) ────────
//
// Imperva's JA3/JA4 TLS fingerprinting and stream-close detection block all
// direct HTTP clients. Plain fetch(), undici, and session cookie reuse all fail.
//
// Bypass: pre-fetch the JS bundle via Node.js (static assets aren't blocked),
// serve it via Puppeteer request interception, then drive the React UI to
// trigger the API call. Response captured via page.on('response').
// No stealth plugin needed — the bundle bypass is sufficient.

async function loadPageWithBundleBypass(page) {
  const bundleContent = await fetch(`${PHARMACY_STOCK_URL}index-bundle.js`).then(r => r.text());

  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    if (url.includes('index-bundle.js')) {
      req.respond({ status: 200, contentType: 'application/javascript', body: bundleContent });
    } else if (url.includes('glassbox') || url.includes('gb.clalit')) {
      // Block Glassbox – it monkey-patches window.fetch and causes API calls to fail
      req.respond({ status: 200, contentType: 'application/javascript', body: '' });
    } else {
      req.continue();
    }
  });

  await page.goto(PHARMACY_STOCK_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));
}

async function captureStockResponse(page, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      page.off('response', handler);
      fn(val);
    };
    const timer = setTimeout(
      () => settle(reject, new Error('Timeout waiting for stock API response')),
      timeoutMs
    );
    const handler = async res => {
      if (!res.url().includes('GetPharmacyStock')) return;
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('application/json')) {
        settle(reject, new Error(`WAF_BLOCKED:${res.status()}`));
        return;
      }
      try {
        settle(resolve, await res.json());
      } catch (err) {
        settle(reject, err);
      }
    };
    page.on('response', handler);
  });
}

// Pick the first dropdown suggestion whose text satisfies matchFn, or fall back to index 0.
async function uiPickSuggestion(page, menuSelector, matchFn) {
  const items = await page.$$(menuSelector);
  for (const li of items) {
    const text = await li.evaluate(el => el.textContent?.trim());
    if (text && matchFn(text)) { await li.click(); return; }
  }
  if (items.length > 0) await items[0].click();
}

async function uiSelectMedication(page, omryName) {
  await page.click('#downshift-0-input');
  await page.type('#downshift-0-input', omryName.split(' ')[0], { delay: 60 });
  await new Promise(r => setTimeout(r, 1800));
  await uiPickSuggestion(page, '[id^="downshift-0-menu"] li',
    text => text === omryName || text.includes(omryName));
  await new Promise(r => setTimeout(r, 300));
}

async function uiSubmit(page) {
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await btn.evaluate(el => el.textContent?.trim());
    if (text?.includes('בדיקת מלאי')) { await btn.click(); return; }
  }
}

async function stockCheck(medicationsList, { cityCode, cityName, pharmacyName }) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );
    await loadPageWithBundleBypass(page);

    const responsePromise = captureStockResponse(page);

    if (cityCode) {
      // Click the "יישוב" (city/settlement) tab – switches second input to downshift-2-input
      const tabLinks = await page.$$('[class*="TabMenuItem__Link"]');
      for (const link of tabLinks) {
        const text = await link.evaluate(el => el.textContent?.trim());
        if (text?.includes('יישוב')) { await link.click(); break; }
      }
      await new Promise(r => setTimeout(r, 300));
    }

    await uiSelectMedication(page, medicationsList[0].omryName);

    if (cityCode) {
      // After clicking the יישוב tab the city input ID becomes downshift-2-input
      const citySearchWord = cityName.replace(/-/g, ' ').split(' ').find(w => w.length > 1) ?? cityName;
      await page.click('#downshift-2-input');
      await page.type('#downshift-2-input', citySearchWord, { delay: 60 });
      await new Promise(r => setTimeout(r, 1800));
      await uiPickSuggestion(page, '[id^="downshift-2-menu"] li',
        // Exact match preferred; avoid single-word header separators in the dropdown
        text => text === cityName || (text.includes(citySearchWord) && text.length > citySearchWord.length));
    } else {
      await page.click('#downshift-1-input');
      await page.type('#downshift-1-input', pharmacyName.split(' ')[0], { delay: 60 });
      await new Promise(r => setTimeout(r, 1800));
      await uiPickSuggestion(page, '[id^="downshift-1-menu"] li',
        text => text.includes(pharmacyName.split(' ')[0]));
    }
    await new Promise(r => setTimeout(r, 300));

    await uiSubmit(page);
    return await responsePromise;
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
  const label = filterQuery
    ? `Found ${filtered.length} cities matching "${filterQuery}":`
    : `Found ${filtered.length} cities:`;
  console.log(`${label}\n`);
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
  // Resolve catCode → omryName. The API is text-only, so we scan letter prefixes.
  // Scan both a-z (Latin brand names) and Hebrew letters (some medications use Hebrew names).
  const nameMap = new Map(catCodes.map(c => [c, String(c)]));
  const remaining = new Set(catCodes);
  const prefixes = 'abcdefghijklmnopqrstuvwxyz\u05d0\u05d1\u05d2\u05d3\u05d4\u05d5\u05d6\u05d7\u05d8\u05d9\u05db\u05dc\u05de\u05e0\u05e1\u05e2\u05e4\u05e6\u05e7\u05e8\u05e9\u05ea';
  for (const prefix of prefixes) {
    if (remaining.size === 0) break;
    const results = await searchPost('GetFilterefMedicationsList', {
      searchText: encodeSearchText(prefix),
      isPrefix: true,
    }).catch(() => null);
    for (const med of results ?? []) {
      if (remaining.has(med.catCode)) {
        nameMap.set(med.catCode, med.omryName);
        remaining.delete(med.catCode);
      }
    }
  }
  return nameMap;
}

function printStockResults(data) {
  if (!data || data.isEmptyResult || !data.pharmaciesList || data.pharmaciesList.length === 0) {
    console.log('No pharmacies found for this search.');
    return;
  }
  for (const ph of data.pharmaciesList) {
    const headerParts = [ph.pharmacyName];
    if (ph.pharmacyAdress) headerParts.push(ph.pharmacyAdress);
    if (ph.pharmacyPhone) headerParts.push(ph.pharmacyPhone);
    headerParts.push(ph.ifOpenedNow ? 'פתוח' : 'סגור');
    console.log(`\n  ${headerParts.join(' | ')}`);
    for (const med of ph.medicationsList ?? []) {
      console.log(`    ${med.medicationName}: ${stockLabel(med.kodStatusMlay)}`);
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
  if (cityCode === null && pharmacyCode === null) {
    console.error('Error: provide --city <cityCode> or --pharmacy <deptCode>');
    process.exit(1);
  }

  console.log('Resolving medication names...');
  const nameMap = await resolveOmryNames(catCodes);
  const medicationsList = catCodes.map(code => ({
    catCode: code,
    omryName: nameMap.get(code) ?? String(code),
  }));

  // Resolve city/pharmacy name for UI interaction (API is text-based, not code-based)
  let cityName, pharmacyName;
  if (cityCode) {
    const allCities = await searchPost('GetAllCitiesList', {});
    cityName = allCities?.find(c => c.cityCode === cityCode)?.cityName ?? String(cityCode);
  } else {
    const HEBREW_PREFIXES = ['בית', 'מרקחת', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ', 'ק', 'ר', 'ש', 'ת'];
    const match = await findByPrefix('GetFilterefPharmaciesList', HEBREW_PREFIXES, true, p => p.deptCode === pharmacyCode);
    if (!match) {
      console.error(`Cannot resolve pharmacy deptCode ${pharmacyCode}. Use "pharmacies <query>" to find a valid deptCode.`);
      process.exit(1);
    }
    pharmacyName = match.deptName;
  }

  console.log('Launching browser for stock check...');
  try {
    const data = await stockCheck(medicationsList, { cityCode, pharmacyCode, cityName, pharmacyName });
    if (data.isWsError) {
      console.error('Stock API returned an error. Please try again later.');
      process.exit(1);
    }
    printStockResults(data);
  } catch (err) {
    if (err.message?.startsWith('WAF_BLOCKED')) {
      console.error('Request was blocked by Clalit WAF. This may happen if Clalit has updated their security policy.');
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
      console.log(`  PASS ${label}`);
      passed++;
    } catch (err) {
      console.log(`  FAIL ${label}: ${err.message}`);
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
    if (!results.some(c => c.cityName.includes('תל'))) throw new Error('No תל cities found');
  });

  await check('pharmacies "כללית" returns results', async () => {
    const results = await searchPost('GetFilterefPharmaciesList', {
      searchText: encodeSearchText('כללית'),
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
    case 'search':     await cmdSearch(rest); break;
    case 'pharmacies': await cmdPharmacies(rest); break;
    case 'cities':     await cmdCities(rest); break;
    case 'stock':      await cmdStock(rest); break;
    case 'test':       await cmdTest(); break;
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
