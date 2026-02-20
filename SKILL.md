---
name: clalit-pharm-search
description: Search for medications and check real-time stock availability at Clalit pharmacies in Israel. Use when searching for drugs like "amoxicillin", "acamol/אקמול", "nurofen", or finding nearby Clalit pharmacy branches with stock. Supports Hebrew and English drug names. כללית, בית מרקחת, תרופות, מלאי, בדיקת מלאי, בית מרקחת כללית.
license: MIT
compatibility: Requires Node.js 18+ and internet access. The `stock` command requires Puppeteer (headless Chrome, ~300 MB download on first use).
metadata:
  author: tomron
  version: "1.0.0"
---

# Clalit Pharmacy Stock Check

Search medications and check **real-time stock availability** at Clalit (כללית) pharmacy locations across Israel.

> **Disclaimer**: This is an unofficial tool, not affiliated with or endorsed by Clalit Health Services. Stock information is queried from the same APIs that power the Clalit website and may not reflect actual availability. Always call the pharmacy to confirm stock before visiting.

## Quick Start

```bash
# 1. Search for medication (get the catCode)
node {baseDir}/scripts/pharmacy-search.js search "amoxicillin"
# Returns: 1000157274 | AMOXAPEN 29M SUS 250MG/5ML 100

# 2. Find your city code
node {baseDir}/scripts/pharmacy-search.js cities "תל אביב"
# Returns: 5000 | תל-אביב-יפו

# 3. Check which pharmacies have it in stock
node {baseDir}/scripts/pharmacy-search.js stock 1000157274 --city 5000
# Returns: Pharmacies with addresses, phones, open/closed status, stock status
```

## Commands

| Command | Description |
|---------|-------------|
| `search <query>` | Find medications, get catCode |
| `stock <catCode> --city <cityCode>` | Check stock at all pharmacies in a city |
| `stock <catCode> --pharmacy <deptCode>` | Check stock at a specific branch |
| `pharmacies <query>` | Search pharmacy branches by name |
| `cities [query]` | List cities with optional name filter |
| `test` | Quick connectivity check |

## Search Examples

```bash
# Hebrew searches
node {baseDir}/scripts/pharmacy-search.js search "אקמול"
node {baseDir}/scripts/pharmacy-search.js search "נורופן"

# English searches
node {baseDir}/scripts/pharmacy-search.js search "acamol"
node {baseDir}/scripts/pharmacy-search.js search "amoxicillin"
```

## Stock Check by City

```bash
# Tel Aviv (city code 5000)
node {baseDir}/scripts/pharmacy-search.js stock 1000157274 --city 5000

# Jerusalem (city code 3000)
node {baseDir}/scripts/pharmacy-search.js stock 1000157274 --city 3000

# Multiple medications at once
node {baseDir}/scripts/pharmacy-search.js stock 1000157274 1000234567 --city 5000
```

Run `cities` to search for city codes.

## Stock Check by Pharmacy Branch

```bash
# First find the branch deptCode
node {baseDir}/scripts/pharmacy-search.js pharmacies "רמת"

# Then check stock at that specific branch
node {baseDir}/scripts/pharmacy-search.js stock 1000157274 --pharmacy 11431
```

## Stock Status Labels

| Status | Meaning |
|--------|---------|
| `במלאי` | In stock |
| `מלאי מוגבל` | Limited stock — call pharmacy |
| `אין במלאי` | Out of stock |
| `אין מידע` | No information available |

## Notes

- `search`, `pharmacies`, `cities`, and `test` use plain HTTP — fast, no browser needed
- `stock` uses Puppeteer (headless Chrome) to bypass WAF protection — takes ~2–4 seconds
- Puppeteer downloads Chromium (~300 MB) automatically on first `npm install`
- If Clalit re-enables reCAPTCHA, the `stock` command may require updates
