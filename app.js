(() => {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                          */
  /* ------------------------------------------------------------------ */
  const LETTERS = 'ABCDEFGH'.split('');
  const CDN = 'https://cdn.torrid.com/i/torrid/';

  // Layout:  A B / C D / E F / G H   (index 0..7, col = i % 2, row = i >> 1)
  const letter = (i) => LETTERS[i] || '?';

  // Copied from 2026/11_Nov/22/app/marketing-box/new.json
  const DEFAULT_TEMPLATE = {
    MarketingTiles: [
      {
        img: 'https://cdn.torrid.com/i/torrid/261117_MB_2x1_intern_jeans2',
        action: 'plp',
        assetType: '2x1',
        destination: 'Clothing_Jeans',
        pageIndex: 'page1SlotC',
        isActive: true,
      },
    ],
  };

  // Planning-sheet headers. Used as the default column order when a paste has no header row,
  // and as the header row of the Excel export.
  // Current-state feature is hidden for now. Add ?current to the URL to show it (tests turn it on with ?test).
  const FEATURES = { currentState: /[?&](test|current)\b/.test(location.search) };
  const DEFAULT_BOX = 'Marketing_Box'; // Category_ID used when a paste has no category row
  const DEFAULT_HEADERS = {
    groups: ['::: CATEGORIES', '::: SITE MERCH UPDATES', '::: SITE OPS UPDATES'],
    // path | viewport | slot | type | title | link | notes | QA | x | asset
    columns: ['URL / ID', 'VIEWPORT', 'TYPE', '', 'MB Content Name (No Characters)', 'URL / ID (MB Link)', 'NOTES', 'QA Ready', '', 'ASSET ID / AMP Image Name'],
  };

  // Mirrors the planning sheet: category rows, then DESKTOP / MOBILE and APP blocks (A-H).
  const SAMPLE = (() => {
    const L = 'ABCDEFGH'.split('');
    const dbl = (i) => (i % 2 === 0 ? 'Double' : 'Single');
    const block = (path, platform, fill) =>
      L.map((l, i) => {
        const f = fill[l] || [];
        // path | platform | slot | single/double | title | destination | note | spacer | check | asset
        return [i === 0 ? path : '', i === 0 ? platform : '', l, dbl(i), f[0] || '', f[1] || '', f[2] || '', '', f[3] ? 'x' : '', f[3] || ''].join('\t');
      });
    const cat = (section, cgid, path, desktop, app) =>
      [section, cgid, ...block(path, 'DESKTOP / MOBILE', desktop), ...block('', 'APP', app)];
    return [
      ...cat('DRESSES', 'Clothing_Dresses', '/clothing/dresses/',
        { D: ['November Icon Spotlight', '/brands/nightfall/shop-all/', '', '2611_MB_2x1_icon'], F: ['Belle Isle Holiday Dresses', '/brands/belle-isle/shop-all/', '', '261111_MB_1x1_belleisle1'], G: ['The Party Place', '/featured/holiday-shop/party/', 'Moved down to spot G from Spot D', '261111_MB_2x1_party'] },
        { C: ['November Icon Spotlight', 'Brands_Nightfall_ShopAll', '', '2611_MB_2x1_icon'], G: ['The Party Place', 'Featured_Holiday_Shop_Party', '', '261111_MB_2x1_party'] }),
      ...cat('JEANS', 'Clothing_Jeans', '/clothing/jeans/', {},
        { B: ['In Style Intern', 'Clothing_Jeans', 'Sheet has a 2x1 in B', '261117_MB_2x1_intern_jeans2'], D: ['Bombshell Super Flare', 'Clothing_Jeans_Bombshell', '', '261117_MB_1x1_bombshell'], H: ['New in Boots', 'ShoesAccessories_Shoes_BootsBooties', '', '261013_MB_1x1_boots'] }),
      ...cat('TOPS', 'Clothing_Tops', '/clothing/tops/', {},
        { A: ['Sweater Weather', 'Clothing_Tops_Sweaters', '', '261110_MB_2x1_sweaters'], D: ['Cozy Edit', 'NewNow_Featured_Cozy', '', '261110_MB_1x1_cozy'], E: ['Tees', 'Clothing_Tops_TShirts', '', '261110_MB_1x1_tshirts'] }),
    ].join('\n');
  })();

  /* ------------------------------------------------------------------ */
  /* Parsing                                                            */
  /* ------------------------------------------------------------------ */
  function parseTable(text) {
    const delim = text.indexOf('\t') >= 0 ? '\t' : ',';
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else quoted = false;
        } else cell += c;
      } else if (c === '"' && cell === '') {
        quoted = true;
      } else if (c === delim) {
        row.push(cell);
        cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        cell = '';
        rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    rows.push(row);
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }

  const ROLES = [
    { key: 'category', label: 'Marketing box', re: /box|categor|page|plp|location|section/i },
    { key: 'slot', label: 'Slot', re: /slot|position|placement/i },
    { key: 'asset', label: 'Asset', re: /asset|image|img|creative|file/i },
    { key: 'size', label: 'Size (optional)', re: /size|dimension|ratio|asset type/i },
    { key: 'destination', label: 'Destination', re: /destination|cgid|landing|mb link|link/i },
    { key: 'action', label: 'Action (optional)', re: /action/i },
    { key: 'note', label: 'Notes (optional)', re: /^notes?$/i },
    { key: 'title', label: 'Title (optional)', re: /title|name|description|campaign|promo/i },
  ];
  // Order of matching matters: more specific roles claim headers first.
  const MATCH_ORDER = ['destination', 'slot', 'size', 'asset', 'action', 'category', 'note', 'title'];

  function guessMapping(headers) {
    const map = {};
    const used = new Set();
    ROLES.forEach((r) => (map[r.key] = -1));
    MATCH_ORDER.forEach((key) => {
      const role = ROLES.find((r) => r.key === key);
      const idx = headers.findIndex((h, i) => !used.has(i) && role.re.test(h));
      if (idx >= 0) {
        map[key] = idx;
        used.add(idx);
      }
    });
    return map;
  }

  function detectHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const m = guessMapping(rows[i]);
      const hits = Object.values(m).filter((v) => v >= 0).length;
      if (hits >= 3 && (m.slot >= 0 || m.asset >= 0)) return { index: i, mapping: m };
    }
    // No header row. A wide paste is assumed to follow the planning-sheet columns
    // (DEFAULT_HEADERS): the slot, link and asset columns are located from the data,
    // and the title / notes sit either side of the link column.
    const width = Math.max(...rows.slice(0, 20).map((r) => r.length));
    if (width >= 8) {
      const best = (test, fallback) => {
        const counts = Array(width).fill(0);
        rows.forEach((r) => r.forEach((c, i) => test(String(c || '').trim()) && counts[i]++));
        const max = Math.max(...counts);
        return max > 0 ? counts.indexOf(max) : fallback;
      };
      const dest = best((c) => DEST_RE.test(c) && !ASSET_RE.test(c), 5);
      return {
        index: -1,
        mapping: {
          category: -1,
          slot: best((c) => /^[A-H]$/.test(c), 2),
          size: -1,
          asset: best((c) => ASSET_RE.test(c), 9),
          destination: dest,
          action: -1,
          title: Math.max(dest - 1, 0),
          note: dest + 1,
        },
      };
    }
    // Narrow paste: assume Marketing Box, Slot, Asset, Destination
    return {
      index: -1,
      mapping: { category: 0, slot: 1, asset: 2, size: -1, destination: 3, action: -1, title: -1 },
    };
  }

  function parseSlot(v) {
    const s = String(v || '').trim();
    if (!s) return -1;
    const m = s.match(/slot\s*([A-J])/i) || s.match(/^([A-J])$/i) || s.match(/\b([A-J])\b/i);
    if (!m) return -1;
    const i = LETTERS.indexOf(m[1].toUpperCase());
    return i; // -1 for I/J (outside the 8-slot layout)
  }

  function parseSize(sizeCell, asset) {
    const re = /(?:^|[^0-9])([12])\s*[x×]\s*1(?![0-9])/i;
    const m = String(sizeCell || '').match(re) || String(asset || '').match(re);
    return m ? m[1] + 'x1' : null;
  }

  function inferAction(dest) {
    if (/^https?:\/\//i.test(dest)) return 'webView';
    if (/^\d{6,}$/.test(dest)) return 'pdp';
    return 'plp';
  }

  function normAction(a) {
    const s = String(a || '').trim();
    if (!s) return '';
    return /^webview$/i.test(s) ? 'webView' : s.toLowerCase() === 'externalwebview' ? 'externalwebview' : s.toLowerCase();
  }

  // Generic column layout: one row per tile, columns mapped by the user.
  function recordsFromColumns(rows, headerIndex, mapping) {
    const get = (r, key) => (mapping[key] >= 0 ? String(r[mapping[key]] || '').trim() : '');
    const recs = [];
    let current = '';
    rows.slice(headerIndex + 1).forEach((r) => {
      const cat = get(r, 'category');
      if (cat) current = cat;
      recs.push({
        category: current,
        platform: '',
        slot: get(r, 'slot'),
        asset: get(r, 'asset'),
        destination: get(r, 'destination'),
        title: get(r, 'title'),
        size: get(r, 'size'),
        action: get(r, 'action'),
        note: get(r, 'note'),
      });
    });
    return recs;
  }

  // Torrid planning sheet: category header rows, then per-platform blocks of
  //   [path] [platform] [slot letter] [Single|Double] [title] [destination] [note] ... [x] [asset]
  const ASSET_RE = /_MB_|^\d[\w.-]*_/i;
  const DEST_RE = /^\/|^https?:\/\/|^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/;
  const cleanRow = (r) => r.map((c) => String(c || '').trim());
  const findAnchor = (cells) => {
    for (let i = 0; i < cells.length - 1; i++) {
      if (/^[A-H]$/.test(cells[i]) && /^(single|double)$/i.test(cells[i + 1])) return i;
    }
    return -1;
  };

  // Where do title / destination / note live? Prefer the sheet's header row (DEFAULT_HEADERS names).
  function detectBlockColumns(rows) {
    for (const r of rows.slice(0, 20)) {
      const c = cleanRow(r);
      const title = c.findIndex((x) => /content name/i.test(x));
      const dest = c.findIndex((x) => /mb link/i.test(x));
      if (title >= 0 && dest >= 0) {
        const note = c.findIndex((x) => /^notes$/i.test(x));
        return { title, dest, note: note >= 0 ? note : dest + 1 };
      }
    }
    // No header row: assume the default planning-sheet order (DEFAULT_HEADERS), where the title,
    // link and notes columns are adjacent. Find the link column from the data (most common
    // destination-looking column), then title = column before it, notes = column after it.
    const counts = {};
    rows.forEach((r) => {
      const c = cleanRow(r);
      const a = findAnchor(c);
      if (a < 0) return;
      c.forEach((x, i) => {
        if (i > a + 1 && x && DEST_RE.test(x) && !ASSET_RE.test(x)) counts[i] = (counts[i] || 0) + 1;
      });
    });
    const top = Object.keys(counts).sort((p, q) => counts[q] - counts[p])[0];
    if (top !== undefined) return { title: +top - 1, dest: +top, note: +top + 1 };
    return null;
  }

  function recordsFromBlocks(rows) {
    const recs = [];
    const cols = detectBlockColumns(rows);
    let category = '';
    let platform = '';
    let block = 0;
    let path = '';
    let seen = false; // rows already read under the current platform label
    rows.forEach((r) => {
      const cells = cleanRow(r);
      const a = findAnchor(cells);
      if (a < 0) {
        // Category rows (e.g. "NEW", then "New") only use the first column; this skips
        // label rows such as "Updates" that sit in the viewport column.
        const first = cells[0];
        if (first && /^[A-Za-z0-9_-]+$/.test(first) && !/^(updates|viewport|type|notes)$/i.test(first)) {
          category = first;
          block++; // two blocks can share a name (e.g. "New"), so key by position
          path = '';
          seen = false;
        }
        return;
      }
      const plat = cells.slice(0, a).find((c) => /^(app|desktop|mobile|web)/i.test(c));
      const label = plat ? plat.toUpperCase().replace(/\s+/g, ' ') : '';
      if (label) {
        // The same platform label again (e.g. several APP blocks pasted back to back with no
        // category rows) starts a new block.
        if (label === platform && seen) {
          block++;
          path = '';
        }
        if (label !== platform) seen = false;
        platform = label;
      }
      seen = true;
      const pathCell = cells.slice(0, a).find((c) => c.startsWith('/'));
      if (pathCell && !path) path = pathCell;
      const rec = { category, block, path, platform, slot: cells[a], slotType: cells[a + 1], title: '', destination: '', asset: '', note: '', size: '', action: '' };
      const after = cells.slice(a + 2);
      rec.asset = after.find((c) => ASSET_RE.test(c)) || '';
      if (cols) {
        rec.title = cells[cols.title] || '';
        rec.destination = cells[cols.dest] || '';
        rec.note = cells[cols.note] || '';
      } else {
        after.forEach((c) => {
          if (!c || /^(x|✓|✔|true)$/i.test(c) || c === rec.asset) return;
          if (DEST_RE.test(c)) rec.destination = rec.destination || c;
          else if (!rec.title) rec.title = c;
          else if (!rec.note) rec.note = c;
        });
      }
      // DESKTOP / MOBILE rows are ignored; this tool only builds APP marketing boxes.
      if (/desktop|mobile|web/i.test(platform)) return;
      // A leftover asset with no title/destination is a removed tile ("removed rosy & cozy").
      if (rec.title || rec.destination) recs.push(rec);
    });
    return recs;
  }

  // Naming convention: a web path becomes a category ID. Each path segment is PascalCased
  // (hyphens dropped, trailing numbers kept as "-N") and segments are joined with "_".
  //   /todays-deals/shop-clothing-intimates-1/  ->  TodaysDeals_ShopClothingIntimates-1
  const WEB_PATH = /^\/(?!\/)/;
  function urlToCgid(url) {
    return String(url)
      .split(/[?#]/)[0]
      .split('/')
      .filter(Boolean)
      .map((seg) =>
        seg
          .split('-')
          .filter(Boolean)
          .map((w) => (/^\d+$/.test(w) ? '-' + w : w.charAt(0).toUpperCase() + w.slice(1)))
          .join('')
      )
      .join('_');
  }

  function buildBoxes(records, opts) {
    const get = (r, key) => r[key] || '';
    const boxes = [];
    const byName = new Map();
    let n = 0;

    records.forEach((r) => {
      const current = r.category || DEFAULT_BOX; // pasted without a category row -> default Category_ID
      const slotCell = r.slot;
      const asset = r.asset;
      const rawDest = r.destination;
      const title = r.title;
      if (!asset && !rawDest && !title) return; // empty slot

      // Sheet blocks are keyed by position (two blocks can both be called "New");
      // plain column data is keyed by name.
      const key = r.block !== undefined ? 'b' + r.block : current;
      let box = byName.get(key);
      if (!box) {
        box = { name: current, isDefault: !r.category, path: r.path || (WEB_PATH.test(current) ? current : ''), tiles: [], open: false };
        byName.set(key, box);
        boxes.push(box);
      }

      const warnings = [];
      let size = parseSize(get(r, 'size'), asset);
      if (!size) {
        size = '1x1';
        warnings.push('Size not found in asset name – assumed 1x1');
      }
      const requested = parseSlot(slotCell);
      if (requested < 0 && slotCell) warnings.push(`Slot "${slotCell}" is outside A–H`);
      const img = !asset ? '' : /^https?:\/\//i.test(asset) ? asset : CDN + asset.replace(/\.(png|jpe?g|webp|gif)$/i, '');
      const action = normAction(get(r, 'action')) || (rawDest ? inferAction(rawDest) : 'plp');
      const dest = rawDest;
      if (!asset) warnings.push('Missing asset – tile set inactive');
      if (!dest) warnings.push('Missing destination – tile set inactive');
      if (action === 'plp' && dest.startsWith('/')) warnings.push('Destination is a web path – the app needs a category ID');

      box.tiles.push({
        id: ++n,
        title,
        asset,
        img,
        size,
        action,
        destination: dest,
        requested,
        slot: -1,
        sheetSize: size,
        sheetNote: r.note || '',
        notes: warnings, // data warnings (kept)
        moveNote: '', // layout suggestion
      });
    });

    boxes.forEach((b) => {
      planLayout(b.tiles, opts);
    });
    // unique file names
    const seen = {};
    boxes.forEach((b) => {
      // Page URL -> PascalCase file name; otherwise fall back to the box name.
      const f = WEB_PATH.test(b.path)
        ? urlToCgid(b.path).replace(/[^A-Za-z0-9_-]+/g, '_')
        : b.isDefault
          ? b.name
          : b.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'marketing_box';
      const k = f.toLowerCase();
      seen[k] = (seen[k] || 0) + 1;
      b.file = (seen[k] > 1 ? `${f}_${seen[k]}` : f) + '.json';
    });
    return boxes;
  }

  /* ------------------------------------------------------------------ */
  /* Layout logic                                                       */
  /* ------------------------------------------------------------------ */
  // A 2x1 spans a full row: A+B, C+D, E+F, G+H (starts on A, C, E or G).
  const footprint = (size, s) => (size === '2x1' ? [s, s + 1] : [s]);

  function planLayout(tiles, opts) {
    const o = Object.assign({ reserveBeside: true }, opts);
    const occ = Array(8).fill(null); // tile covering a slot
    const res = Array(8).fill(null); // 2x1 reserving a slot ("no stacking")

    const can = (t, s) => {
      if (!(s >= 0 && s < 8)) return false;
      if (t.size === '2x1' && s % 2 !== 0) return false;
      if (!footprint(t.size, s).every((c) => !occ[c] && (t.size === '2x1' || !res[c]))) return false;
      // 1x1s may not stack on other 1x1s in the same column (A/C, B/D, C/E ...).
      if (t.size !== '2x1' && o.reserveBeside) {
        for (const n of [s - 2, s + 2]) if (n >= 0 && n < 8 && occ[n] && occ[n].size !== '2x1') return false;
      }
      return true;
    };
    const put = (t, s) => {
      footprint(t.size, s).forEach((c) => (occ[c] = t));
      if (t.size === '2x1' && o.reserveBeside) [s + 2, s + 3].forEach((c) => c < 8 && (res[c] = t));
      t.slot = s;
    };
    const whyNot = (t, req) => {
      if (req < 0) return 'No usable slot in sheet';
      if (t.size === '2x1' && req % 2 !== 0) return `2x1 only fits A, C, E, G (was ${letter(req)})`;
      for (const c of footprint(t.size, req)) {
        if (occ[c]) {
          return occ[c].size === '2x1' && occ[c].slot !== req
            ? `${letter(c)} is covered by the 2x1 in ${letter(occ[c].slot)} (was ${letter(req)})`
            : `${letter(c)} already used (was ${letter(req)})`;
        }
        if (res[c]) {
          return `${letter(c)} sits directly below the 2x1 in ${letter(res[c].slot)} – avoids stacking (was ${letter(req)})`;
        }
      }
      if (t.size !== '2x1' && o.reserveBeside) {
        const n = [req - 2, req + 2].find((x) => x >= 0 && x < 8 && occ[x] && occ[x].size !== '2x1');
        if (n !== undefined) return `${letter(req)} would stack with the 1x1 in ${letter(n)} – avoids stacking (was ${letter(req)})`;
      }
      return `Slot unavailable (was ${letter(req)})`;
    };

    const twos = tiles.filter((t) => t.size === '2x1').sort((a, b) => key(a) - key(b));
    const ones = tiles.filter((t) => t.size !== '2x1');
    function key(t) {
      return t.requested < 0 ? 99 : t.requested;
    }

    [...twos, ...ones].forEach((t) => {
      t.moveNote = '';
      const req = t.requested;
      if (can(t, req)) return put(t, req);
      const reason = whyNot(t, req);
      const cands = [0, 1, 2, 3, 4, 5, 6, 7]
        .filter((s) => can(t, s))
        // Same column first, then closest, then forward (D -> F, B -> C).
        .sort(
          (a, b) =>
            (a % 2 === req % 2 ? 0 : 1) - (b % 2 === req % 2 ? 0 : 1) ||
            Math.abs(a - req) - Math.abs(b - req) ||
            (a >= req ? 0 : 1) - (b >= req ? 0 : 1) ||
            a - b
        );
      if (!cands.length) {
        t.slot = -1;
        t.moveNote = `${reason} – no free slot left, not placed`;
        return;
      }
      put(t, cands[0]);
      t.moveNote = `${reason} → ${letter(cands[0])}`;
    });
  }

  // Re-validate after a manual change (no automatic moves).
  function checkLayout(tiles, opts) {
    const o = Object.assign({ reserveBeside: true }, opts);
    const out = new Map();
    const add = (t, m) => {
      if (!out.has(t.id)) out.set(t.id, []);
      out.get(t.id).push(m);
    };
    const occ = Array(8).fill(null);
    const res = Array(8).fill(null);
    tiles.filter((t) => t.slot < 0).forEach((t) => add(t, 'Not placed – pick a slot'));
    const placed = tiles.filter((t) => t.slot >= 0);
    placed
      .filter((t) => t.size === '2x1')
      .forEach((t) => {
        if (t.slot % 2) add(t, '2x1 only fits A, C, E, G');
        footprint(t.size, t.slot).forEach((c) => {
          if (occ[c]) add(t, `Overlaps ${letter(occ[c].slot)}`);
          else occ[c] = t;
        });
        if (o.reserveBeside) [t.slot + 2, t.slot + 3].forEach((c) => c < 8 && (res[c] = t));
      });
    placed
      .filter((t) => t.size !== '2x1')
      .forEach((t) => {
        if (occ[t.slot]) {
          add(t, occ[t.slot].size === '2x1' ? `Covered by 2x1 in ${letter(occ[t.slot].slot)}` : 'Slot already used');
        } else if (res[t.slot]) {
          add(t, `Directly below the 2x1 in ${letter(res[t.slot].slot)}`);
          occ[t.slot] = t;
        } else occ[t.slot] = t;
      });
    // A 1x1 may not sit directly above/below another 1x1 in the same column.
    if (o.reserveBeside) {
      const ones = placed.filter((t) => t.size !== '2x1');
      ones.forEach((t) => {
        const other = ones.find((x) => x !== t && x.slot === t.slot + 2);
        if (other) {
          add(t, `Stacked above the 1x1 in ${letter(other.slot)}`);
          add(other, `Stacked below the 1x1 in ${letter(t.slot)}`);
        }
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* JSON output                                                        */
  /* ------------------------------------------------------------------ */
  function parseTemplate(text) {
    const t = JSON.parse(text);
    if (!t || !Array.isArray(t.MarketingTiles) || !t.MarketingTiles.length || typeof t.MarketingTiles[0] !== 'object') {
      throw new Error('Template needs a "MarketingTiles" array with at least one tile');
    }
    return t;
  }

  function tileJson(proto, t) {
    const values = {
      img: t.img,
      action: t.action,
      assetType: t.size,
      destination: t.destination,
      pageIndex: `${t.page || 'page1'}Slot${letter(t.slot)}`,
      isActive: t.active !== undefined ? !!t.active : !!(t.img && t.destination),
    };
    const out = {};
    Object.keys(proto).forEach((k) => {
      out[k] = k in values ? values[k] : proto[k];
    });
    Object.keys(values).forEach((k) => {
      if (!(k in out)) out[k] = values[k];
    });
    Object.keys(t.extra || {}).forEach((k) => {
      if (!(k in out)) out[k] = t.extra[k]; // keys from a loaded file that the template does not know about
    });
    if ('description' in out && t.title && !('description' in values)) out.description = t.title;
    return out;
  }

  function boxJson(box, template) {
    const proto = template.MarketingTiles[0];
    const tiles = box.tiles
      .filter((t) => t.slot >= 0)
      .sort((a, b) => a.slot - b.slot)
      .map((t) => tileJson(proto, t));
    const root = {};
    Object.keys(template).forEach((k) => {
      root[k] = k === 'MarketingTiles' ? tiles : template[k];
    });
    return JSON.stringify(root, null, 4) + '\n';
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                 */
  /* ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const state = {
    rows: [],
    mode: 'columns',
    records: [],
    platforms: [],
    platform: '',
    headerIndex: -1,
    mapping: {},
    boxes: [],
    current: [],
    currentSkipped: 0,
    currentLabel: '',
    removed: new Set(),
    template: DEFAULT_TEMPLATE,
  };

  const opts = () => ({ reserveBeside: $('opt-beside').checked });

  function setTemplateStatus(msg, ok) {
    const el = $('template-status');
    el.textContent = msg;
    el.className = 'small mt-1 ' + (ok ? 'text-success' : 'text-danger');
  }

  function renderMapping() {
    const wrap = $('mapping-wrap');
    if (!state.rows.length || state.mode === 'blocks') {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const width = Math.max(...state.rows.slice(0, 10).map((r) => r.length));
    const header = state.headerIndex >= 0 ? state.rows[state.headerIndex] : [];
    const colName = (i) => (header[i] && header[i].trim()) || `Column ${i + 1}`;
    $('mapping').innerHTML = ROLES.map((role) => {
      const opts = ['<option value="-1">— none —</option>']
        .concat(
          Array.from({ length: width }, (_, i) =>
            `<option value="${i}"${state.mapping[role.key] === i ? ' selected' : ''}>${esc(colName(i))}</option>`
          )
        )
        .join('');
      return `<div class="col-6 col-md-3"><label class="form-label small text-muted mb-1">${role.label}</label>
        <select class="form-select form-select-sm" data-role="${role.key}">${opts}</select></div>`;
    }).join('');
  }

  /* ---------------- Current state (existing JSON files that are live today) ---------------- */
  const KNOWN_TILE_KEYS = ['img', 'action', 'assetType', 'destination', 'pageIndex', 'isActive'];
  const currentKey = (c) => (c.dir ? c.dir + '/' : '') + c.file;
  const matchKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  // entries: [{ file, dir, text }] -> state.current (invalid files are counted, not loaded)
  function applyCurrent(entries, label) {
    const out = [];
    let skipped = 0;
    entries.forEach((e) => {
      try {
        const j = JSON.parse(String(e.text).replace(/^﻿/, ''));
        if (!j || !Array.isArray(j.MarketingTiles)) return skipped++;
        out.push({ file: e.file, dir: e.dir || '', tiles: j.MarketingTiles });
      } catch (err) {
        skipped++;
      }
    });
    out.sort((a, b) => currentKey(a).localeCompare(currentKey(b)));
    state.current = out;
    state.currentLabel = label || '';
    state.currentSkipped = skipped;
    state.removed = new Set();
    process(false);
  }

  // From the folder picker (subfolders included).
  async function loadCurrent(fileList) {
    const entries = [];
    for (const f of [...fileList].filter((x) => /\.json$/i.test(x.name))) {
      const parts = (f.webkitRelativePath || f.name).split('/');
      entries.push({ file: f.name, dir: parts.slice(1, -1).join('/'), text: await f.text() });
    }
    applyCurrent(entries, 'folder');
  }

  // Built-in snapshots (current-state/*.js, made by build-current-state.ps1).
  const SNAPSHOT_ID = '2026-11-19';
  const snapshot = () => (window.CURRENT_STATES || {})[SNAPSHOT_ID];
  const loadSnapshot = () => snapshot() && applyCurrent(snapshot().files, snapshot().label);

  // Fresh box objects from the loaded files each time (cards mutate their tiles).
  function buildCurrentBoxes() {
    return state.current
      .filter((c) => !state.removed.has(currentKey(c)))
      .map((c) => ({
        name: c.file.replace(/\.json$/i, ''),
        isCurrent: true,
        key: currentKey(c),
        dir: c.dir,
        path: '',
        file: c.file,
        open: false,
        deleted: [],
        tiles: c.tiles.map((raw, i) => {
          const m = /Slot([A-J])$/i.exec(raw.pageIndex || '');
          const slot = m ? LETTERS.indexOf(m[1].toUpperCase()) : -1;
          const size = raw.assetType === '2x1' ? '2x1' : '1x1';
          const extra = {};
          Object.keys(raw).forEach((k) => {
            if (!KNOWN_TILE_KEYS.includes(k)) extra[k] = raw[k];
          });
          return {
            id: i + 1,
            origin: 'current',
            page: ((/^(page\d+)Slot/i.exec(raw.pageIndex || '') || [])[1] || 'page1').toLowerCase(),
            title: '',
            asset: String(raw.img || '').split('?')[0].split('/').pop(),
            img: raw.img || '',
            size,
            sheetSize: size,
            action: raw.action === undefined ? 'plp' : raw.action, // keep "" as-is: loaded files are written back unchanged
            destination: raw.destination || '',
            requested: slot,
            slot,
            sheetNote: '',
            notes: [],
            moveNote: '',
            active: raw.isActive,
            extra,
          };
        }),
      }));
  }

  // Sheet rows replace whatever the live file has in the same slots; everything else is kept.
  function mergeInto(cur, sheet) {
    const overlaps = (a, b) => a.slot >= 0 && b.slot >= 0 && footprint(a.size, a.slot).some((c) => footprint(b.size, b.slot).includes(c));
    const keep = cur.tiles.filter((ct) => !sheet.tiles.some((st) => overlaps(ct, st)));
    cur.replaced = cur.tiles.length - keep.length;
    sheet.tiles.forEach((t) => (t.origin = 'sheet'));
    cur.tiles = [...keep, ...sheet.tiles];
    cur.tiles.forEach((t, i) => (t.id = i + 1));
    cur.updated = true;
    if (sheet.path) cur.path = sheet.path;
  }

  function combineWithCurrent(sheetBoxes) {
    if (!state.current.length) return sheetBoxes;
    const cur = buildCurrentBoxes();
    const fresh = [];
    sheetBoxes.forEach((sb) => {
      const keys = [matchKey(sb.name), matchKey(sb.file.replace(/\.json$/i, ''))];
      const hit = cur.find((c) => !c.updated && keys.includes(matchKey(c.name)));
      if (hit) mergeInto(hit, sb);
      else {
        sb.isNew = true;
        fresh.push(sb);
      }
    });
    return [...fresh, ...cur];
  }

  // Boxes included in the zip / xlsx: with a current state loaded, "only changed" skips untouched files.
  function exportBoxes() {
    const only = $('only-changed').checked;
    return state.boxes.filter((b) => !only || !b.isCurrent || b.updated || b.dirty);
  }

  function process(fromPaste) {
    const text = $('paste').value;
    let sheetBoxes = [];
    let message = '';
    if (!text.trim()) {
      state.rows = [];
    } else {
      if (fromPaste) {
        state.rows = parseTable(text);
        const blocks = recordsFromBlocks(state.rows); // APP rows only
        const hasBlocks = state.rows.some((r) => findAnchor(cleanRow(r)) >= 0);
        if (blocks.length >= 2 || hasBlocks) {
          state.mode = 'blocks';
          state.records = blocks;
        } else {
          state.mode = 'columns';
          const d = detectHeader(state.rows);
          state.headerIndex = d.index;
          state.mapping = d.mapping;
        }
      }
      const records =
        state.mode === 'blocks' ? state.records : recordsFromColumns(state.rows, state.headerIndex, state.mapping);
      sheetBoxes = buildBoxes(records, opts());
      const tiles = sheetBoxes.reduce((n, b) => n + b.tiles.length, 0);
      const moved = sheetBoxes.reduce((n, b) => n + b.tiles.filter((t) => t.moveNote).length, 0);
      message = sheetBoxes.length
        ? `${sheetBoxes.length} marketing box${sheetBoxes.length === 1 ? '' : 'es'} in the sheet · ${tiles} tiles · ${moved} suggested move${moved === 1 ? '' : 's'}${sheetBoxes.some((b) => b.isDefault) ? ` · no category rows found, using the default Category_ID "${DEFAULT_BOX}" (rename the file on each card)` : ''}`
        : state.mode === 'blocks'
          ? 'No APP slots found (DESKTOP / MOBILE rows are ignored).'
          : 'No marketing boxes found – check the column mapping below.';
    }
    state.boxes = combineWithCurrent(sheetBoxes);

    // Current-state controls
    const loaded = state.current.length > 0;
    $('btn-current-clear').hidden = !loaded;
    $('changed-wrap').hidden = !loaded;
    const upd = state.boxes.filter((b) => b.updated).length;
    const fresh = state.boxes.filter((b) => b.isNew).length;
    $('current-status').textContent = loaded
      ? `Current state${state.currentLabel && state.currentLabel !== 'folder' ? ' (' + state.currentLabel + ')' : ''}: ${state.boxes.filter((b) => b.isCurrent).length} of ${state.current.length} files shown` +
        (state.currentSkipped ? ` (${state.currentSkipped} skipped: not marketing box JSON)` : '') +
        (text.trim() ? ` · sheet updates ${upd} existing, ${fresh} new` : ' · paste a sheet to apply updates')
      : '';
    $('parse-status').textContent = message;
    renderMapping();
    renderResults();
  }

  function slotGridHtml(box, warns, idx) {
    const cells = [];
    const covered = new Set();
    box.tiles.forEach((t) => {
      if (t.slot < 0) return;
      footprint(t.size, t.slot).forEach((c) => covered.add(c));
      const row = (t.slot >> 1) + 1;
      const col = t.size === '2x1' ? '1 / span 2' : (t.slot % 2) + 1;
      const cls = warns.has(t.id) ? 'bad' : t.moveNote ? 'moved' : '';
      const name = t.title || t.asset || '(no asset)';
      // Asset attached: show the creative instead of the plain dark box (preview size only; JSON keeps the plain URL).
      const preview = t.img ? t.img + (t.img.includes('?') ? '' : '?wid=300&fmt=auto') : '';
      const img = preview
        ? `<img class="s-img" src="${esc(preview)}" alt="" loading="lazy" draggable="false" onerror="this.parentNode.classList.remove('has-img');this.remove()" />`
        : '';
      cells.push(
        `<div class="slot filled ${t.size === '2x1' ? 'wide' : ''} ${preview ? 'has-img' : ''} ${cls}" draggable="true" data-box="${idx}" data-slot="${t.slot}" data-drag-tile="${t.id}"
          style="grid-column:${col};grid-row:${row}" title="${esc(name)} – drag to move">
          ${img}
          <div class="s-top"><span>${letter(t.slot)}</span><span>${t.size}</span></div>
          <div class="s-name">${esc(name)}</div></div>`
      );
    });
    for (let s = 0; s < 8; s++) {
      if (covered.has(s)) continue;
      cells.push(
        `<div class="slot" data-box="${idx}" data-slot="${s}" style="grid-column:${(s % 2) + 1};grid-row:${(s >> 1) + 1}"><div class="s-top"><span>${letter(s)}</span></div></div>`
      );
    }
    return `<div class="slot-grid">${cells.join('')}</div>`;
  }

  // Category_ID = the JSON file name without the extension.
  const categoryIdOf = (box) => (box.file || '').trim().replace(/\.json$/i, '');

  function cardHtml(box, idx) {
    const warns = checkLayout(box.tiles, opts());
    const json = boxJson(box, state.template);
    const moves = box.tiles.filter((t) => t.moveNote).length;
    const issues = warns.size;
    const rows = box.tiles
      .map((t) => {
        const w = (warns.get(t.id) || []).map((m) => `<div class="note">${esc(m)}</div>`).join('');
        const dataNotes =
          t.notes.map((m) => `<div class="note">${esc(m)}</div>`).join('') +
          (t.sheetNote ? `<div class="text-muted small">Sheet: ${esc(t.sheetNote)}</div>` : '');
        const move = t.moveNote ? `<div class="note ok">${esc(t.moveNote)}</div>` : '';
        const options = ['<option value="-1">—</option>']
          .concat(LETTERS.map((l, i) => `<option value="${i}"${t.slot === i ? ' selected' : ''}>${l}</option>`))
          .join('');
        const sizeOptions = ['1x1', '2x1'].map((s) => `<option${t.size === s ? ' selected' : ''}>${s}</option>`).join('');
        const sizeNote = t.size !== t.sheetSize ? `<div class="text-muted small">Size changed from ${t.sheetSize}</div>` : '';
        return `<tr>
          <td class="drag-cell"><span class="drag-handle" draggable="true" data-box="${idx}" data-drag-tile="${t.id}" title="Drag onto a slot in the layout" aria-label="Drag tile">⠿</span></td>
          <td><div class="asset" title="${esc(t.asset)}">${esc(t.asset || '—')}</div>
              <div class="text-muted small">${esc(t.title || '')}</div></td>
          <td>${t.requested >= 0 ? letter(t.requested) : '—'} <span class="text-muted">· ${t.sheetSize}</span></td>
          <td><select class="form-select form-select-sm" aria-label="Slot" data-box="${idx}" data-tile="${t.id}">${options}</select></td>
          <td><select class="form-select form-select-sm" aria-label="Size" data-box="${idx}" data-size-tile="${t.id}">${sizeOptions}</select></td>
          <td>${move}${w}${sizeNote}${dataNotes}${box.updated && t.origin === 'current' ? '<div class="text-muted small">Kept from current file</div>' : ''}</td>
          <td class="text-end"><button class="btn btn-sm btn-icon" data-act="delete" data-box="${idx}" data-tile="${t.id}" title="Delete tile" aria-label="Delete tile">&times;</button></td></tr>`;
      })
      .join('');
    const originBadge = box.isNew
      ? '<span class="badge badge-new">New</span>'
      : box.updated
        ? `<span class="badge badge-ok">Updated${box.replaced ? ` · ${box.replaced} replaced` : ''}</span>`
        : box.isCurrent
          ? `<span class="badge badge-soft">${box.dirty ? 'Current · edited' : 'Current'}</span>`
          : '';
    const undo = box.deleted && box.deleted.length ? `<button class="btn btn-sm btn-outline-secondary" data-act="undo" data-box="${idx}">Undo delete (${box.deleted.length})</button>` : '';
    return `
      <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div class="d-flex flex-wrap align-items-end gap-3">
          <div class="id-part"><small>URL</small><span class="id-url" title="Page URL">${esc(box.path || '—')}</span></div>
          <span class="id-sep">|</span>
          <div class="id-part"><small>Category_ID</small><span class="fw-semibold" data-category-id="${idx}">${esc(categoryIdOf(box))}</span></div>
          <span class="id-sep">|</span>
          <div class="id-part"><small>Category_ID.json</small>
            <input class="form-control form-control-sm file-input" data-file="${idx}" value="${esc(box.file)}" aria-label="File name" spellcheck="false" /></div>
          <span class="badge badge-soft">${box.tiles.length} tile${box.tiles.length === 1 ? '' : 's'}</span>
          ${originBadge}
          ${moves ? `<span class="badge badge-warn">${moves} moved</span>` : ''}
          ${issues ? `<span class="badge badge-warn">${issues} to fix</span>` : ''}
        </div>
        <div class="d-flex gap-2">
          ${undo}
          ${box.isCurrent ? `<button class="btn btn-sm btn-outline-secondary" data-act="remove-box" data-box="${idx}" title="Hide this file (not exported)">Remove</button>` : ''}
          <button class="btn btn-sm btn-outline-secondary" data-act="copy" data-box="${idx}">Copy</button>
          <button class="btn btn-sm btn-dark" data-act="download" data-box="${idx}">Download JSON</button>
        </div>
      </div>
      <div class="card-body">
        <div class="row g-4">
          <div class="col-lg-8 col-xl-9 order-2 order-lg-1">
            <div class="table-responsive">
              <table class="table table-sm tile-table mb-0">
                <thead><tr><th></th><th>Asset</th><th>Sheet</th><th>Slot</th><th>Size</th><th>Notes</th><th></th></tr></thead>
                <tbody>${rows || '<tr><td colspan="7" class="text-muted small">No tiles in this box.</td></tr>'}</tbody>
              </table>
            </div>
          </div>
          <div class="col-lg-4 col-xl-3 order-1 order-lg-2">
            ${slotGridHtml(box, warns, idx)}
            <div class="small text-muted mt-2">Drag a tile onto a slot to move it. Dropping on another tile swaps them.</div>
          </div>
        </div>
        <details data-box="${idx}"${box.open ? ' open' : ''}>
          <summary class="small fw-semibold mt-3">JSON preview</summary>
          <pre class="json">${esc(json)}</pre>
        </details>
      </div>`;
  }

  // Move a tile to a slot. A 2x1 snaps to the start of its row; dropping on an occupied
  // slot swaps the two tiles. Anything invalid is flagged by checkLayout, not auto-fixed.
  function moveTile(box, tile, target) {
    let to = target;
    if (tile.size === '2x1' && to % 2) to -= 1;
    const old = tile.slot;
    const hit = box.tiles.find((t) => t !== tile && t.slot >= 0 && footprint(t.size, t.slot).includes(to));
    tile.slot = to;
    tile.moveNote = '';
    if (hit) {
      let back = old;
      if (hit.size === '2x1' && back > 0 && back % 2) back -= 1;
      hit.slot = back;
      hit.moveNote = '';
    }
  }

  function renderResults() {
    const el = $('results');
    $('bulk-actions').hidden = !state.boxes.length;
    if (!state.boxes.length) {
      el.innerHTML = '<p class="text-muted">Nothing to show yet. Paste a spreadsheet above.</p>';
      return;
    }
    el.innerHTML = state.boxes.map((b, i) => `<div class="card box-card mb-4" id="box-${i}">${cardHtml(b, i)}</div>`).join('');
  }

  function rerenderBox(i) {
    $('box-' + i).innerHTML = cardHtml(state.boxes[i], i);
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Bulk export: .zip of all JSON, .xlsx of slot information           */
  /* ------------------------------------------------------------------ */
  const today = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  function fileNameOf(box) {
    const n = (box.file || 'marketing_box').trim().replace(/[\\/:*?"<>|]+/g, '_');
    return /\.json$/i.test(n) ? n : n + '.json';
  }

  function saveBlob(name, blob) {
    if (window.__capture) return window.__capture(name, blob); // self-test hook
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadZip() {
    if (typeof JSZip === 'undefined') return alert('The zip library could not load (internet access is needed).');
    const zip = new JSZip();
    const folder = zip.folder('marketing-box-json');
    const used = {};
    exportBoxes().forEach((b) => {
      let n = fileNameOf(b);
      const base = n.replace(/\.json$/i, '');
      let k = 1;
      while (used[n]) n = `${base}_${++k}.json`;
      used[n] = 1;
      folder.file(n, boxJson(b, state.template));
    });
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    saveBlob(`marketing-box-json_${today()}.zip`, blob);
  }

  const slotNote = (t) => {
    const parts = [];
    if (t.sheetNote) parts.push(t.sheetNote);
    if (t.requested < 0) parts.push(`Placed in ${letter(t.slot)} (no slot in sheet)`);
    else if (t.slot !== t.requested) parts.push(`Moved to ${letter(t.slot)} from ${letter(t.requested)}`);
    return parts.join(' · ');
  };

  // Mirrors the planning sheet's APP block layout and headers (desktop / mobile is never exported).
  async function exportXlsx() {
    if (typeof ExcelJS === 'undefined') return alert('The Excel library could not load (internet access is needed).');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('APP Slots', { views: [{ state: 'frozen', ySplit: 2 }] });
    const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    const GREY = 'FFD9D9D9';
    const BLUE = 'FFA6C8EA';
    const ORANGE = 'FFF4B183';
    [34, 18, 4, 9, 38, 40, 34, 9, 4, 34].forEach((w, i) => (ws.getColumn(i + 1).width = w));

    const [g1, g2, g3] = DEFAULT_HEADERS.groups;
    ws.addRow([g1, '', '', '', g2, '', '', '', '', g3]);
    ws.mergeCells('A1:D1');
    ws.mergeCells('E1:G1');
    ws.mergeCells('I1:J1');
    const groupFill = [GREY, GREY, GREY, GREY, 'FFDDEBF7', 'FFDDEBF7', 'FFDDEBF7', null, 'FFFCE4D6', 'FFFCE4D6'];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => {
      c.font = { bold: true, size: 9 };
      if (groupFill[i - 1]) c.fill = fill(groupFill[i - 1]);
    });

    ws.addRow(DEFAULT_HEADERS.columns);
    ws.mergeCells('C2:D2');
    const headFill = [GREY, GREY, GREY, GREY, BLUE, BLUE, BLUE, ORANGE, ORANGE, ORANGE];
    ws.getRow(2).height = 26;
    ws.getRow(2).eachCell({ includeEmpty: true }, (c, i) => {
      c.font = { bold: true };
      c.fill = fill(headFill[i - 1]);
      c.border = border;
      c.alignment = { vertical: 'middle', wrapText: true };
    });

    exportBoxes().forEach((box) => {
      const cat = ws.addRow([box.name]);
      for (let i = 1; i <= 10; i++) {
        cat.getCell(i).fill = fill(GREY);
        cat.getCell(i).font = { bold: true };
      }
      const first = ws.rowCount + 1;
      const placed = box.tiles.filter((t) => t.slot >= 0);
      const covered = new Set();
      placed.forEach((t) => footprint(t.size, t.slot).slice(1).forEach((c) => covered.add(c)));

      for (let i = 0; i < 8; i++) {
        const t = placed.find((x) => x.slot === i);
        const r = ws.addRow([
          i === 0 ? box.path || '' : '',
          i === 0 ? 'APP' : '',
          LETTERS[i],
          i % 2 === 0 ? 'Double' : 'Single',
          t ? t.title : '',
          t ? t.destination : '',
          t ? slotNote(t) : '',
          '',
          t && t.asset ? 'x' : '',
          t ? t.asset : '',
        ]);
        for (let c = 1; c <= 10; c++) r.getCell(c).border = border;
        r.getCell(3).font = { bold: true };
        r.getCell(3).alignment = { horizontal: 'center' };
        if (i === 0) r.getCell(1).font = { color: { argb: 'FF0070C0' } };
        if (t && t.asset) {
          r.getCell(9).fill = fill('FFC6EFCE');
          r.getCell(9).alignment = { horizontal: 'center' };
        }
        if (covered.has(i)) for (let c = 5; c <= 10; c++) r.getCell(c).fill = fill('FFF2F2F2');
      }
      ws.mergeCells(first, 2, first + 7, 2);
      const v = ws.getCell(first, 2);
      v.fill = fill('FFEFEFFF');
      v.font = { bold: true };
      v.alignment = { vertical: 'top' };

      box.tiles
        .filter((t) => t.slot < 0)
        .forEach((t) => {
          const r = ws.addRow(['', '', '—', '', t.title, t.destination, 'Not placed – no free slot', '', t.asset ? 'x' : '', t.asset]);
          for (let c = 1; c <= 10; c++) {
            r.getCell(c).border = border;
            r.getCell(c).fill = fill('FFFDE9E7');
          }
        });
    });

    const buf = await wb.xlsx.writeBuffer();
    saveBlob(
      `marketing-box-slots_${today()}.xlsx`,
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    );
  }

  function wire() {
    // Layout rules + template panel: hidden by default, toggled from the header.
    $('btn-rules').addEventListener('click', () => {
      const panel = $('rules-panel');
      panel.hidden = !panel.hidden;
      $('btn-rules').setAttribute('aria-expanded', String(!panel.hidden));
    });

    // Current state: pick the folder of live marketing box JSON files.
    $('btn-current').addEventListener('click', () => $('current-files').click());
    $('btn-current').hidden = !FEATURES.currentState;
    $('btn-snapshot').hidden = !(FEATURES.currentState && snapshot());
    $('btn-snapshot').addEventListener('click', loadSnapshot);
    $('current-files').addEventListener('change', async (e) => {
      await loadCurrent(e.target.files);
      e.target.value = ''; // allow re-picking the same folder
    });
    $('btn-current-clear').addEventListener('click', () => {
      state.current = [];
      state.removed = new Set();
      state.currentSkipped = 0;
      process(false);
    });
    $('btn-zip').addEventListener('click', downloadZip);
    $('btn-xlsx').addEventListener('click', exportXlsx);
    $('template').value = JSON.stringify(DEFAULT_TEMPLATE, null, 4);
    setTemplateStatus('Using new.json template', true);

    $('paste').addEventListener('input', () => process(true));
    $('btn-sample').addEventListener('click', () => {
      $('paste').value = SAMPLE;
      process(true);
    });
    $('btn-clear').addEventListener('click', () => {
      $('paste').value = '';
      process(true);
    });
    $('opt-beside').addEventListener('change', () => process(false));

    $('template').addEventListener('input', () => {
      try {
        state.template = parseTemplate($('template').value);
        setTemplateStatus('Template valid', true);
        renderResults();
      } catch (e) {
        setTemplateStatus(e.message, false);
      }
    });

    $('mapping').addEventListener('change', (e) => {
      const role = e.target.dataset.role;
      if (!role) return;
      state.mapping[role] = parseInt(e.target.value, 10);
      process(false);
    });

    $('results').addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.sizeTile !== undefined) {
        // Size changed: re-suggest placement, keeping every tile's current slot where it is still valid.
        const b = state.boxes[+t.dataset.box];
        b.tiles.find((x) => x.id === +t.dataset.sizeTile).size = t.value;
        b.dirty = true;
        const sheet = b.tiles.map((x) => x.requested);
        b.tiles.forEach((x) => {
          if (x.slot >= 0) x.requested = x.slot;
        });
        planLayout(b.tiles, opts());
        b.tiles.forEach((x, i) => (x.requested = sheet[i]));
        rerenderBox(+t.dataset.box);
        return;
      }
      if (t.dataset.tile === undefined) return;
      const box = state.boxes[+t.dataset.box];
      const tile = box.tiles.find((x) => x.id === +t.dataset.tile);
      tile.slot = parseInt(t.value, 10);
      box.dirty = true;
      tile.moveNote = tile.slot === tile.requested ? '' : tile.moveNote;
      rerenderBox(+t.dataset.box);
    });

    // Drag and drop: tiles (layout grid or list handle) onto a slot in the same box's layout.
    const res = $('results');
    let drag = null;
    res.addEventListener('dragstart', (e) => {
      const src = e.target.closest && e.target.closest('[data-drag-tile]');
      if (!src) return;
      drag = { box: +src.dataset.box, tile: +src.dataset.dragTile };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `${drag.box}:${drag.tile}`);
        const row = src.closest('tr');
        if (row && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 0, 0);
      }
      src.classList.add('dragging');
    });
    res.addEventListener('dragend', () => {
      drag = null;
      res.querySelectorAll('.dragging, .over').forEach((x) => x.classList.remove('dragging', 'over'));
    });
    const dropTarget = (e) => {
      const slot = e.target.closest && e.target.closest('.slot[data-slot]');
      return slot && drag && +slot.dataset.box === drag.box ? slot : null;
    };
    res.addEventListener('dragover', (e) => {
      const slot = dropTarget(e);
      if (!slot) return;
      e.preventDefault();
      res.querySelectorAll('.over').forEach((x) => x !== slot && x.classList.remove('over'));
      slot.classList.add('over');
    });
    res.addEventListener('dragleave', (e) => {
      const slot = e.target.closest && e.target.closest('.slot');
      if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove('over');
    });
    res.addEventListener('drop', (e) => {
      const slot = dropTarget(e);
      if (!slot) return;
      e.preventDefault();
      const box = state.boxes[drag.box];
      const tile = box.tiles.find((t) => t.id === drag.tile);
      const idx = drag.box;
      drag = null;
      if (!tile) return;
      moveTile(box, tile, +slot.dataset.slot);
      box.dirty = true;
      rerenderBox(idx);
    });

    // Editable file name (no re-render so the input keeps focus).
    $('results').addEventListener('input', (e) => {
      if (e.target.dataset.file === undefined) return;
      const b = state.boxes[+e.target.dataset.file];
      b.file = e.target.value;
      // Category_ID is always the file name without ".json".
      const id = document.querySelector(`[data-category-id="${e.target.dataset.file}"]`);
      if (id) id.textContent = categoryIdOf(b);
    });

    $('results').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const box = state.boxes[+b.dataset.box];
      if (b.dataset.act === 'remove-box') {
        state.removed.add(box.key);
        process(false);
        return;
      }
      if (b.dataset.act === 'delete') {
        const i = box.tiles.findIndex((t) => t.id === +b.dataset.tile);
        if (i >= 0) {
          (box.deleted = box.deleted || []).push(box.tiles.splice(i, 1)[0]);
          box.dirty = true;
          rerenderBox(+b.dataset.box);
        }
        return;
      }
      if (b.dataset.act === 'undo') {
        if (box.deleted && box.deleted.length) box.tiles.push(box.deleted.pop());
        box.dirty = true;
        rerenderBox(+b.dataset.box);
        return;
      }
      const json = boxJson(box, state.template);
      if (b.dataset.act === 'download') {
        const name = (box.file || 'marketing_box').trim().replace(/[\\/:*?"<>|]+/g, '_');
        download(/\.json$/i.test(name) ? name : name + '.json', json);
      }
      else if (navigator.clipboard) {
        navigator.clipboard.writeText(json).then(() => {
          const old = b.textContent;
          b.textContent = 'Copied';
          setTimeout(() => (b.textContent = old), 1200);
        });
      }
    });

    // <details> toggle doesn't bubble – capture it so the open state survives re-renders.
    $('results').addEventListener(
      'toggle',
      (e) => {
        if (e.target.dataset && e.target.dataset.box !== undefined && e.target.tagName === 'DETAILS') {
          state.boxes[+e.target.dataset.box].open = e.target.open;
        }
      },
      true
    );
  }

  /* ------------------------------------------------------------------ */
  /* Self-test (open index.html?test)                                   */
  /* ------------------------------------------------------------------ */
  function runTests() {
    const mk = (size, requested, id) => ({ id, size, requested, slot: -1, notes: [], moveNote: '' });
    const plan = (specs, o) => {
      const tiles = specs.map(([s, r], i) => mk(s, LETTERS.indexOf(r), i + 1));
      planLayout(tiles, o);
      return tiles.map((t) => letter(t.slot)).join('');
    };
    const cases = [
      ['2x1 in B moves to closest 2x1 slot', plan([['2x1', 'B']]), 'C'],
      ['2x1 in H moves to G', plan([['2x1', 'H']]), 'G'],
      ['1x1 works anywhere', plan([['1x1', 'A'], ['1x1', 'B'], ['1x1', 'H']]), 'ABH'],
      ['2x1 A + 1x1 D → F (user example)', plan([['2x1', 'A'], ['1x1', 'D']]), 'AF'],
      ['2x1 A + 1x1 C → next free slot in same column', plan([['2x1', 'A'], ['1x1', 'C']]), 'AE'],
      ['1x1 in B under a 2x1 in A moves to F', plan([['2x1', 'A'], ['1x1', 'B']]), 'AF'],
      ['reserve toggle off keeps D', plan([['2x1', 'A'], ['1x1', 'D']], { reserveBeside: false }), 'AD'],
      ['two 2x1s in A do not overlap', plan([['2x1', 'A'], ['2x1', 'A']]), 'AC'],
      ['1x1s in A and C: second moves to E (no 1x1 stacking)', plan([['1x1', 'A'], ['1x1', 'C']]), 'AE'],
      ['1x1s in B and D: second moves to F', plan([['1x1', 'B'], ['1x1', 'D']]), 'BF'],
      ['1x1s side by side (A, B) are fine', plan([['1x1', 'A'], ['1x1', 'B']]), 'AB'],
      ['1x1 stacking allowed when toggle is off', plan([['1x1', 'A'], ['1x1', 'C']], { reserveBeside: false }), 'AC'],
      ['1x1 in A above a 2x1 in C is fine', plan([['2x1', 'C'], ['1x1', 'A']]), 'CA'],
      ['2x1 in G covers G+H, 1x1 H moves', plan([['2x1', 'G'], ['1x1', 'H']]), 'GF'],
    ];
    const recs = recordsFromBlocks(parseTable(SAMPLE));
    const dresses = recs.filter((r) => r.category === 'Clothing_Dresses' && r.platform === 'APP');
    const party = dresses.find((r) => r.slot === 'G') || {};
    cases.push(
      ['sheet parser: 3 categories', [...new Set(recs.map((r) => r.category))].join(','), 'Clothing_Dresses,Clothing_Jeans,Clothing_Tops'],
      ['sheet parser: APP Dresses has 2 tiles', String(dresses.filter((r) => r.asset).length), '2'],
      ['sheet parser: fields', [party.title, party.destination, party.asset].join('|'), 'The Party Place|Featured_Holiday_Shop_Party|261111_MB_2x1_party']
    );
    // "New" block from the planning sheet, with the "Updates" label row.
    const row = (...c) => c.join('\t');
    const newBlock = [
      row('URL / ID', 'VIEWPORT', 'TYPE', '', 'MB Content Name (No Characters)', 'URL / ID (MB Link)', 'NOTES', '', 'QA Ready', 'ASSET ID / AMP Image Name'),
      row('NEW'),
      row('New', 'Updates'),
      row('/todays-deals/shop-clothing-intimates-1/', 'DESKTOP / MOBILE', 'A', 'Single'),
      row('', '', 'D', 'Double', 'The Super Soft Collection', '/featured/super-soft-collection/', '', '', '', 'x', '261111_MB_2x1_supersoft'),
      row('', 'APP', 'A', 'Double'),
      row('', '', 'C', 'Double', 'New in the Holiday Shop', 'NewNow_Featured_HolidayShop', '', '', '', 'x', '261111_MB_2x1_holiday'),
      row('', '', 'D', 'Single'),
    ].join('\n');
    const nr = recordsFromBlocks(parseTable(newBlock)).filter((r) => r.platform === 'APP' && r.asset);
    cases.push(
      ['New block: category is "New" (not "Updates")', nr.map((r) => r.category).join(','), 'New'],
      ['New block: APP tile', nr.map((r) => [r.slot, r.title, r.destination, r.asset].join('|')).join(';'), 'C|New in the Holiday Shop|NewNow_Featured_HolidayShop|261111_MB_2x1_holiday']
    );
    // Real rows from the 11/22 planning sheet: two blocks both labelled "New", notes column,
    // a "removed" row that still has an asset, and a non-MB asset name.
    const R = (path, plat, slot, type, title, url, note, asset) =>
      row(path, plat, slot, type, title, url, note, '', '', '', asset ? 'x' : '', asset || '');
    const real = [
      row('URL / ID', 'VIEWPORT', 'TYPE', '', 'MB Content Name (No Characters)', 'URL / ID (MB Link)', 'NOTES', '', 'QA Ready', '', '', 'ASSET ID / AMP Image Name'),
      row('NEW'),
      row('New', 'Updates'),
      R('/todays-deals/shop-clothing-intimates-1/', 'DESKTOP / MOBILE', 'A', 'Single'),
      R('', 'APP', 'C', 'Double', 'New in the Holiday Shop', 'NewNow_Featured_HolidayShop', '', '261111_MB_2x1_holiday'),
      row('New'),
      R('/new/', 'DESKTOP / MOBILE', 'D', 'Double', 'Rosy N Cozy', '/featured/rosy/', '', '261111_MB_2x1_rosycozy'),
      R('', 'APP', 'B', 'Single', 'In Style Intern', 'Clothing_Jeans', 'CTA Version Shop Jeans', '261117_MB_1x1_intern_jeans1'),
      R('', '', 'G', 'Double', '', '', 'removed rosy & cozy', '261111_MB_2x1_rosycozy'),
      R('', '', 'H', 'Single', 'New In Holiday Shop', 'NewNow_Featured_HolidayShop', 'Moved down and now a 1x1', '261111_MB_1x1_holiday_v2'),
      row('New_DailyDrop'),
      R('/new/the-daily-drop/', 'APP', 'C', 'Double', 'Casting Call_Winner', 'NewNow_Featured_X', '', '8.8_SB_Torrid26_CC2026_WinnerAn'),
    ].join('\n');
    const rr = recordsFromBlocks(parseTable(real)).filter((r) => r.platform === 'APP');
    const boxes = buildBoxes(rr, { reserveBeside: true });
    const nb = boxes.map((b) => `${b.name}:${b.file}:${b.tiles.length}`).join(' ');
    const second = boxes[1] ? boxes[1].tiles.map((t) => t.title + '/' + t.sheetNote).join(';') : '';
    cases.push(
      ['real sheet: duplicate "New" blocks stay separate', nb, 'New:TodaysDeals_ShopClothingIntimates-1.json:1 New:New.json:2 New_DailyDrop:New_TheDailyDrop.json:1'],
      ['real sheet: removed row skipped, notes in notes col', second, 'In Style Intern/CTA Version Shop Jeans;New In Holiday Shop/Moved down and now a 1x1'],
      ['real sheet: block path captured', boxes[1] ? boxes[1].path : '', '/new/'],
      ['real sheet: non-MB asset kept', boxes[2] ? boxes[2].tiles[0].asset : '', '8.8_SB_Torrid26_CC2026_WinnerAn']
    );

    // No header row pasted -> default planning-sheet column order is assumed.
    const noHeader = real.split('\n').slice(1).join('\n');
    const nh = buildBoxes(recordsFromBlocks(parseTable(noHeader)).filter((r) => r.platform === 'APP'), { reserveBeside: true });
    const nhSecond = nh[1] ? nh[1].tiles.map((t) => t.title + '/' + t.sheetNote).join(';') : '';
    const flat = [
      row('', '', 'C', '', 'New in the Holiday Shop', 'NewNow_Featured_HolidayShop', 'Top banner', '', '', 'x', '261111_MB_2x1_holiday'),
      row('', '', 'F', '', 'In Style Intern', 'Clothing_Jeans', '', '', '', 'x', '261117_MB_1x1_intern_jeans1'),
    ].join('\n');
    const fd = detectHeader(parseTable(flat));
    const fb = buildBoxes(recordsFromColumns(parseTable(flat), fd.index, fd.mapping), { reserveBeside: true });
    const ft = fb[0] ? fb[0].tiles.map((t) => [letter(t.slot), t.size, t.title, t.destination, t.sheetNote].join('|')).join(';') : '';
    const urlRows = [
      row('Marketing Box', 'Slot', 'Asset', 'Destination', 'Title'),
      row('/todays-deals/shop-clothing-intimates-1/', 'A', '261111_MB_1x1_x', '/todays-deals/shop-clothing-intimates-1/', 'Deals'),
      row('', 'B', '261111_MB_1x1_y', 'https://www.tiktok.com/@instyle/video/1', 'Video'),
    ].join('\n');
    const ud = detectHeader(parseTable(urlRows));
    const ub = buildBoxes(recordsFromColumns(parseTable(urlRows), ud.index, ud.mapping), { reserveBeside: true });
    cases.push(
      ['url -> id: todays deals', urlToCgid('/todays-deals/shop-clothing-intimates-1/'), 'TodaysDeals_ShopClothingIntimates-1'],
      ['url -> id: nested', urlToCgid('/shoes-accessories/shoes/boots-booties/'), 'ShoesAccessories_Shoes_BootsBooties'],
      ['url -> id: single + query', urlToCgid('/new/?sz=1'), 'New'],
      ['url -> file name: path as box name', ub[0] ? ub[0].file : '', 'TodaysDeals_ShopClothingIntimates-1.json'],
      ['destinations are not renamed', ub[0] ? ub[0].tiles[0].destination : '', '/todays-deals/shop-clothing-intimates-1/'],
      ['url -> id: full URL left alone (webView)', ub[0] ? `${ub[0].tiles[1].destination}|${ub[0].tiles[1].action}` : '', 'https://www.tiktok.com/@instyle/video/1|webView']
    );
    // Headerless APP block with no category row (the pasted sample): default Category_ID is used.
    const appBlock = (a, b) =>
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
        .map((l, i) => {
          const t = i === 2 ? a : i === 7 ? b : null;
          return R('', i === 0 ? 'APP' : '', l, i % 2 ? 'Single' : 'Double', t ? t[0] : '', t ? t[1] : '', '', t ? t[2] : '');
        })
        .join('\n');
    const one = appBlock(
      ['The Super Soft Collection', 'NewNow_Featured_SuperSoft_Collection', '261111_MB_2x1_supersoft'],
      ['The Bombshell Super Flare', 'Clothing_Jeans_Bombshell', '261111_MB_1x1_bombshell']
    );
    const hb = buildBoxes(recordsFromBlocks(parseTable(one)), { reserveBeside: true });
    const two = buildBoxes(recordsFromBlocks(parseTable(one + '\n' + appBlock(['Second Block', 'Clothing_Tops', '261111_MB_2x1_tops'], ['', '', ''])), ), { reserveBeside: true });
    cases.push(
      ['headerless APP block: default Category_ID + file', hb.length === 1 ? `${hb[0].name}|${hb[0].file}|${categoryIdOf(hb[0])}` : 'boxes=' + hb.length, 'Marketing_Box|Marketing_Box.json|Marketing_Box'],
      ['headerless APP block: tiles', hb[0] ? hb[0].tiles.map((t) => [letter(t.slot), t.size, t.title, t.destination, t.asset].join('|')).join(';') : '', 'C|2x1|The Super Soft Collection|NewNow_Featured_SuperSoft_Collection|261111_MB_2x1_supersoft;H|1x1|The Bombshell Super Flare|Clothing_Jeans_Bombshell|261111_MB_1x1_bombshell'],
      ['two headerless APP blocks pasted together stay separate', two.map((b) => b.file + ':' + b.tiles.length).join(' '), 'Marketing_Box.json:2 Marketing_Box_2.json:1'],
      ['no header: sheet blocks still parse', nhSecond, 'In Style Intern/CTA Version Shop Jeans;New In Holiday Shop/Moved down and now a 1x1'],
      ['no header: wide flat rows use default columns', ft, 'C|2x1|New in the Holiday Shop|NewNow_Featured_HolidayShop|Top banner;H|1x1|In Style Intern|Clothing_Jeans|']
    );
    const el = $('test-results');
    el.innerHTML = cases
      .map(([name, got, want]) => `<div class="${got === want ? 'pass' : 'fail'}">${got === want ? 'PASS' : 'FAIL'} ${esc(name)} → got ${got}, want ${want}</div>`)
      .join('');
    const failed = cases.filter((c) => c[1] !== c[2]).length;
    document.title = failed ? `TESTS FAILED ${failed}` : 'TESTS PASSED';
  }

  wire();
  if (/[?&]test\b/.test(location.search)) {
    runTests();
    $('paste').value = SAMPLE;
    process(true);
    // Build the real zip + xlsx, read them back and report what they contain.
    (async () => {
      const saved = [];
      window.__capture = (n, b) => saved.push([n, b]);
      const line = (ok, msg) => ($('test-results').innerHTML += `<div class="${ok ? 'pass' : 'fail'}">${ok ? 'PASS' : 'FAIL'} ${esc(msg)}</div>`);
      try {
        await downloadZip();
        await exportXlsx();
        const z = await JSZip.loadAsync(saved[0][1]);
        const names = Object.keys(z.files).filter((f) => !z.files[f].dir).sort();
        line(names.join(',') === 'marketing-box-json/Clothing_Dresses.json,marketing-box-json/Clothing_Jeans.json,marketing-box-json/Clothing_Tops.json', 'zip contains ' + names.join(', '));
        const j = JSON.parse(await z.file(names[1]).async('string'));
        line(j.MarketingTiles.map((t) => t.pageIndex.slice(9)).join(',') === 'B,C,H', 'zip JSON parses (jeans slots: ' + j.MarketingTiles.map((t) => t.pageIndex.slice(9)).join(',') + ')');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await saved[1][1].arrayBuffer());
        const ws = wb.getWorksheet('APP Slots');
        const head = ws.getRow(2).values.slice(1).join('|');
        line(/URL \/ ID\|VIEWPORT\|TYPE/.test(head) && /MB Content Name \(No Characters\)/.test(head) && /ASSET ID \/ AMP Image Name/.test(head), 'xlsx headers: ' + head);
        let hit = null;
        ws.eachRow((r) => { if (r.getCell(5).value === 'In Style Intern') hit = r; });
        line(hit && hit.getCell(3).value === 'C' && hit.getCell(4).value === 'Double' && /Moved to C from B/.test(hit.getCell(7).value) && hit.getCell(10).value === '261117_MB_2x1_intern_jeans2', 'xlsx slot row: ' + (hit ? [hit.getCell(3).value, hit.getCell(4).value, hit.getCell(7).value, hit.getCell(10).value].join(' | ') : 'missing'));
        // Size dropdown: switch the first tile (C, 2x1) to 1x1 through the real UI handler.
        const sizeSel = document.querySelector('select[data-size-tile]');
        sizeSel.value = '1x1';
        sizeSel.dispatchEvent(new Event('change', { bubbles: true }));
        const t0 = state.boxes[0].tiles[0];
        line(t0.size === '1x1' && t0.slot === 2 && /"assetType": "1x1"/.test(boxJson(state.boxes[0], state.template).split('"MarketingTiles"')[1]), `size dropdown: 2x1 -> 1x1 keeps slot ${letter(t0.slot)}, JSON assetType updated`);
        sizeSel.value = '2x1';

        // Card header shows URL | Category_ID | Category_ID.json
        const head1 = document.querySelector('#box-1 .card-header');
        line(
          head1.querySelector('.id-url').textContent === '/clothing/jeans/' &&
            head1.textContent.includes('Clothing_Jeans') &&
            head1.querySelector('input[data-file]').value === 'Clothing_Jeans.json',
          'card header: ' + [head1.querySelector('.id-url').textContent, state.boxes[1].name, head1.querySelector('input[data-file]').value].join(' | ')
        );

        // Category_ID follows the file name (minus .json), including live edits.
        const fileInput = document.querySelector('#box-1 input[data-file]');
        const idEl = document.querySelector('#box-1 [data-category-id]');
        const idBefore = idEl.textContent;
        fileInput.value = 'Custom_Name.json';
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        const idAfter = idEl.textContent;
        fileInput.value = 'Clothing_Jeans.json';
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        line(idBefore === 'Clothing_Jeans' && idAfter === 'Custom_Name', `Category_ID mirrors file name: ${idBefore} -> ${idAfter}`);

        // Drag and drop through the real handlers (dragstart -> dragover -> drop).
        const fire = (el, type, dt) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        const dnd = (srcSel, tgtSel) => {
          const dt = new DataTransfer();
          const src = document.querySelector(srcSel);
          fire(src, 'dragstart', dt);
          const tgt = document.querySelector(tgtSel);
          fire(tgt, 'dragover', dt);
          fire(tgt, 'drop', dt);
          fire(src, 'dragend', dt);
        };
        const jeans = () => state.boxes[1].tiles;
        const byTitle = (t) => jeans().find((x) => x.title === t);
        const boots = byTitle('New in Boots');
        dnd(`#box-1 .slot[data-drag-tile="${boots.id}"]`, '#box-1 .slot[data-slot="5"]:not(.filled)');
        line(boots.slot === 5, `drag: 1x1 dropped on empty slot F -> ${letter(boots.slot)}`);
        const bomb = byTitle('Bombshell Super Flare');
        const intern = byTitle('In Style Intern');
        dnd(`#box-1 .drag-handle[data-drag-tile="${bomb.id}"]`, `#box-1 .slot.filled[data-drag-tile="${intern.id}"]`);
        line(bomb.slot === 2 && intern.slot === 0, `drag: swap from list handle (1x1 -> C, 2x1 snaps to ${letter(intern.slot)})`);
        const layoutTile = document.querySelector(`#box-1 .slot.filled[data-drag-tile="${bomb.id}"]`);
        line(layoutTile && layoutTile.dataset.slot === '2', 'layout grid re-rendered with the new position');

        // Asset attached -> layout tile uses the CDN image; no asset -> plain dark box.
        const gridHtml = slotGridHtml({ tiles: [jeans()[0], { ...jeans()[1], img: '', asset: '' }] }, new Map(), 1);
        line(
          gridHtml.includes('<img class="s-img" src="https://cdn.torrid.com/i/torrid/261117_MB_2x1_intern_jeans2?wid=300&amp;fmt=auto"') && (gridHtml.match(/<img /g) || []).length === 1,
          'layout tile shows the CDN asset image; tile without an asset stays a plain box'
        );

        // Delete + undo
        document.querySelector(`#box-1 button[data-act="delete"][data-tile="${boots.id}"]`).click();
        const afterDelete = jeans().length;
        const deletedJson = boxJson(state.boxes[1], state.template).includes('page1SlotF');
        document.querySelector('#box-1 button[data-act="undo"]').click();
        line(afterDelete === 2 && !deletedJson && jeans().length === 3, `delete removes tile (${afterDelete} left, gone from JSON) and undo restores (${jeans().length})`);
        let desk = false;
        ws.eachRow((r) => r.eachCell((c) => { if (/desktop/i.test(String(c.value))) desk = true; }));
        line(!desk && ws.getCell('B4').value === 'APP', 'xlsx has APP only (no desktop / mobile)');

        // End to end: paste a headerless APP block into the real textarea.
        const headerless = [
          ['', 'APP', 'A', 'Double'], ['', '', 'B', 'Single'],
          ['', '', 'C', 'Double', '', 'The Super Soft Collection', 'NewNow_Featured_SuperSoft_Collection', '', '', '', 'x', '261111_MB_2x1_supersoft'],
          ['', '', 'D', 'Single'], ['', '', 'E', 'Double'], ['', '', 'F', 'Single'], ['', '', 'G', 'Double'],
          ['', '', 'H', 'Single', '', 'The Bombshell Super Flare', 'Clothing_Jeans_Bombshell', '', '', '', 'x', '261111_MB_1x1_bombshell'],
        ].map((r) => r.join('\t')).join('\n');
        $('paste').value = headerless;
        $('paste').dispatchEvent(new Event('input', { bubbles: true }));
        const card = document.querySelector('#box-0');
        line(
          !!card && card.querySelector('[data-category-id]').textContent === 'Marketing_Box' && card.querySelectorAll('tbody tr').length === 2 && /default Category_ID/.test($('parse-status').textContent),
          'pasting a headerless block shows a card: ' + (card ? card.querySelector('[data-category-id]').textContent : 'none') + ' / ' + $('parse-status').textContent
        );

        // ---- Built-in 11/19 snapshot: 46 real files, each must round-trip unchanged ----
        const snapBtn = $('btn-snapshot');
        $('paste').value = '';
        process(true);
        snapBtn.click();
        const snapFiles = window.CURRENT_STATES['2026-11-19'].files;
        const norm = (tiles) => tiles.map((t) => JSON.stringify(t)).sort().join('\n');
        const mismatched = [];
        state.boxes.forEach((b) => {
          const orig = JSON.parse(snapFiles.find((f) => f.file === b.file).text.replace(/^﻿/, '')).MarketingTiles;
          const out = JSON.parse(boxJson(b, state.template)).MarketingTiles;
          if (norm(orig) !== norm(out)) mismatched.push(b.file);
        });
        line(!snapBtn.hidden && state.boxes.length === 46 && state.currentSkipped === 0 && state.boxes.every((b) => b.isCurrent), `11/19 snapshot button loads ${state.boxes.length} files (${state.currentSkipped} skipped), none from subfolders`);
        line(mismatched.length === 0, 'all loaded 11/19 files export identical tiles' + (mismatched.length ? ': ' + mismatched.join(', ') : ''));
        document.querySelector('#btn-current-clear').click();

        // ---- Current state: load live JSON files, then apply a sheet on top ----
        const tile = (img, action, assetType, destination, slot, isActive) => ({ img, action, assetType, destination, pageIndex: 'page1Slot' + slot, isActive });
        const mk = (name, tiles) => new File([JSON.stringify({ MarketingTiles: tiles })], name);
        await loadCurrent([
          mk('clothing_jeans.json', [
            tile('', 'plp', '2x1', 'Clothing_Jeans_Bombshell', 'C', false),
            tile('https://cdn.torrid.com/i/torrid/261013_MB_1x1_outerwear', 'plp', '1x1', 'Clothing_Jackets', 'D', true),
            tile('https://cdn.torrid.com/i/torrid/261013_MB_1x1_keepme', 'plp', '1x1', 'Keep_Me', 'E', true),
          ]),
          mk('new.json', [tile('https://cdn.torrid.com/i/torrid/261111_MB_1x1_holiday_v2', 'plp', '1x1', 'NewNow_Featured_HolidayShop', 'H', true)]),
          mk('clothing_bottoms.json', [tile('', 'plp', '2x1', 'Clothing_Bottoms_X', 'C', false)]),
          new File(['{"nope": true}'], 'other.json'),
          new File(['not json'], 'broken.json'),
        ]);
        $('paste').value = '';
        process(true);
        line(
          state.boxes.length === 3 && state.currentSkipped === 2 && state.boxes.every((b) => b.isCurrent),
          `load current state: ${state.boxes.length} boxes, ${state.currentSkipped} skipped, ids ${state.boxes.map(categoryIdOf).join(', ')}`
        );
        line(
          boxJson(state.boxes.find((b) => b.file === 'clothing_bottoms.json'), state.template).includes('"isActive": false') &&
            boxJson(state.boxes.find((b) => b.file === 'new.json'), state.template).includes('"pageIndex": "page1SlotH"'),
          'loaded files round-trip (inactive stays inactive, slots kept)'
        );

        $('paste').value = SAMPLE;
        process(true);
        const jb = state.boxes.find((b) => b.file === 'clothing_jeans.json');
        line(
          !!jb && jb.updated && jb.replaced === 2 && jb.tiles.length === 4 && jb.tiles.some((t) => t.origin === 'current' && t.destination === 'Keep_Me'),
          `sheet merges into the matching current file (keeps other slots): updated=${jb && jb.updated}, replaced=${jb && jb.replaced}, tiles=${jb && jb.tiles.length}`
        );
        line(
          state.boxes.filter((b) => b.isNew).map((b) => b.name).join(',') === 'Clothing_Dresses,Clothing_Tops' && state.boxes.filter((b) => b.isCurrent).length === 3,
          'sheet boxes with no current file are marked New and listed first'
        );
        const onlyChanged = exportBoxes().length;
        $('only-changed').checked = false;
        const everything = exportBoxes().length;
        $('only-changed').checked = true;
        line(onlyChanged === 3 && everything === 5, `"Only changed" exports ${onlyChanged} of ${everything} boxes`);
        const cardsBefore = state.boxes.length;
        document.querySelector('#results button[data-act="remove-box"]').click();
        line(state.boxes.length === cardsBefore - 1, 'Remove hides a current file from the list and exports');
        document.querySelector('#btn-current-clear').click();
        line(state.boxes.length === 3 && state.boxes.every((b) => !b.isCurrent), 'Clear current returns to sheet-only boxes');
      } catch (e) {
        line(false, 'export threw: ' + e.message);
      }
      document.title += $('test-results').querySelector('.fail') ? ' / EXPORT FAILED' : ' / EXPORT OK';
    })();
  }
})();
