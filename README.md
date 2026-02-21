# agent-skill-clalit-pharm-search

A Claude Code agent skill for searching medications and checking real-time stock at **Clalit** (כללית) pharmacies in Israel.

Inspired by [agent-skill-maccabi-pharm-search](https://github.com/alexpolonsky/agent-skill-maccabi-pharm-search).

## Installation

```bash
npx skills add tomron/agent-skill-clalit-pharm-search
```

Or clone manually into `~/.claude/skills/`:

```bash
git clone https://github.com/tomron/agent-skill-clalit-pharm-search \
  ~/.claude/skills/clalit-pharm-search
cd ~/.claude/skills/clalit-pharm-search
npm install
```

## Usage

### Workflow

Checking stock is a two-step process:

1. **Find the medication's `catCode`** using `search`
2. **Find your city's `cityCode`** using `cities`
3. **Check stock** using `stock`

---

### `search` — Find medications

```bash
node scripts/pharmacy-search.js search amoxicillin
node scripts/pharmacy-search.js search אקמול
```

**Sample output:**
```
Found 3 medication(s) for "amoxicillin":

  1000157274 | AMOXAPEN 29M SUS 250MG/5ML 100
  1000234567 | AMOXICILLIN 500MG CAPSULES
  1000345678 | AMOXICILLIN+CLAVULANIC ACID 875MG
```

Use the `catCode` (first column) with the `stock` command.

---

### `cities` — List cities

```bash
node scripts/pharmacy-search.js cities           # all cities
node scripts/pharmacy-search.js cities תל אביב   # filter by name
node scripts/pharmacy-search.js cities haifa
```

**Sample output:**
```
Found 3 cities matching "תל אביב":

  5000 | תל-אביב-יפו
  5001 | תל מונד
  5002 | תל שבע
```

Use the `cityCode` (first column) with the `stock --city` command.

---

### `pharmacies` — Find pharmacy branches

```bash
node scripts/pharmacy-search.js pharmacies רמת
```

**Sample output:**
```
Found 4 pharmacy branch(es) for "רמת":

  11431 | רמת אשכול - בית מרקחת - ירושלים
  11532 | רמת גן - בית מרקחת - כללית
```

Use the `deptCode` (first column) with the `stock --pharmacy` command.

---

### `stock` — Check real-time inventory

> **Note:** The `stock` command uses Puppeteer (headless Chrome) to bypass Clalit's WAF protection. It takes ~2–4 seconds to launch and requires ~300 MB for the Chromium download on first use.

**By city:**
```bash
node scripts/pharmacy-search.js stock 1000157274 --city 5000
```

**By specific pharmacy branch:**
```bash
node scripts/pharmacy-search.js stock 1000157274 --pharmacy 11431
```

**Multiple medications at once:**
```bash
node scripts/pharmacy-search.js stock 1000157274 1000234567 --city 5000
```

**Sample output:**
```
  תל אביב מרכז - בית מרקחת - כללית | רחוב דיזנגוף 50, תל אביב | 03-1234567 | פתוח
    AMOXAPEN 29M SUS 250MG/5ML 100: במלאי

  תל אביב צפון - בית מרקחת - כללית | רחוב ארלוזורוב 100, תל אביב | 03-7654321 | סגור
    AMOXAPEN 29M SUS 250MG/5ML 100: אין במלאי

Total: 2 pharmacy branch(es)
```

**Stock status labels:**
| Status | Meaning |
|--------|---------|
| `במלאי` | In stock |
| `מלאי מוגבל` | Limited stock — call pharmacy |
| `אין במלאי` | Out of stock |
| `אין מידע` | No information available |

---

### `test` — Connectivity check

```bash
node scripts/pharmacy-search.js test
```

Runs smoke tests against the Clalit Search API (no browser required):

```
Running smoke tests...

  PASS search "amoxicillin" returns results
  PASS cities "תל" returns Tel Aviv area cities
  PASS pharmacies "כללית" returns results

3 passed, 0 failed
```

---

## Technical notes

- **Search endpoints** (`search`, `pharmacies`, `cities`) use plain HTTP — fast, no browser needed.
- **Stock endpoints** (`stock`) are protected by Imperva/F5 WAF and require a real browser session (Puppeteer).
- reCAPTCHA is currently disabled server-side. If Clalit re-enables it, the `stock` command may require updates.
- All data comes from [e-services.clalit.co.il/PharmacyStock](https://e-services.clalit.co.il/PharmacyStock/).

## Requirements

- Node.js 18+
- Internet access
- Puppeteer (installed via `npm install`) — only needed for `stock` command

## License

MIT
