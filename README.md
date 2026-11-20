# Marketing Box JSON Generator

Paste a marketing-box spreadsheet, review suggested slot placement, download one JSON file per box.

## Use

1. Open `index.html` in a browser (no build step; Bootstrap 5.3.3 loads from CDN).
2. Paste spreadsheet cells. Two formats are recognized:
   - **Planning sheet** (category row such as `Clothing_Dresses`, then DESKTOP / MOBILE and APP blocks with
     slot letter, Single/Double, title, destination, note, asset). Only the platform chosen in the **Platform**
     dropdown is used (APP by default). Empty slots are skipped.
   - **Plain columns** (fallback): `Marketing Box · Slot · Asset · Destination` (+ optional `Size`, `Action`, `Title`),
     remappable under **Column mapping**. A blank Marketing Box cell inherits the one above.
3. Review each box: the grid shows the final layout, amber = moved, and the **Slot** dropdown overrides any suggestion.
4. **Download JSON** (or **Copy**) per box. File name = box name, lower-cased (`Clothing_Jeans` → `clothing_jeans.json`).

## Layout rules

```
| A | B |
| C | D |
| E | F |
| G | H |
```

- 2x1 spans a full row (A+B, C+D, E+F, G+H), so it starts only on A, C, E, G. Otherwise it moves to the closest valid 2x1 slot.
- 1x1 fits any free slot.
- "Avoid stacking" (toggle): no 1x1 directly below a 2x1 (2x1 in A blocks C and D), and no 1x1 directly above or below another 1x1 in the same column (1x1s in A and C → the second moves to E).
- A displaced asset moves to a free slot in the **same column** first, then closest, forward first (D → F, B → C).

## Output

Built from the template in `2026/11_Nov/22/app/marketing-box/new.json` (editable in the app). The first tile in
the template is the prototype; `img`, `action`, `assetType`, `destination`, `pageIndex` and `isActive` are filled in.

- `img`: asset name → `https://cdn.torrid.com/i/torrid/<asset>` (full URLs kept as-is)
- `assetType`: from the Size column, else `2x1` / `1x1` found in the asset name
- `action`: Action column, else `webView` for URLs, `pdp` for numeric IDs, otherwise `plp`
- `isActive`: `false` when asset or destination is missing

Open `index.html?test` to run the layout self-tests.

## Bulk export

- **Download all (.zip):** every box's JSON in a `marketing-box-json/` folder inside one zip (uses the file names shown, including edits).
- **Export slots (.xlsx):** one sheet in the planning-sheet layout (URL / ID · VIEWPORT · TYPE · MB Content Name · URL / ID (MB Link) · NOTES · QA Ready · ASSET ID / AMP Image Name), one A–H APP block per box with the final slots. Moved tiles get a "Moved to X from Y" note; the second half of a 2x1 is shaded.
- DESKTOP / MOBILE rows are always ignored, in the app and in the exports.
- The zip and Excel libraries (JSZip, ExcelJS) load from cdnjs, so these two buttons need internet access.

## Default headers

If a paste has no header row, the planning-sheet column order is assumed:
`URL / ID · VIEWPORT · TYPE (slot + Single/Double) · MB Content Name (No Characters) · URL / ID (MB Link) · NOTES · QA Ready · ASSET ID / AMP Image Name`.
The link column is located from the data, with the title in the column before it and notes in the column after. A
wide paste without Single/Double rows is read as one tile per row. The Excel export uses the same headers.

- Each tile has **Slot** and **Size** dropdowns. Changing the size re-suggests placement (current slots are kept where still valid).

The layout rules and template now live behind the **Layout rules & template** button at the top (hidden by default).

## JSON file naming

A box's file name comes from its page URL: each path segment is PascalCased (hyphens dropped, a trailing number kept as `-N`) and segments are joined with `_`.

- `/todays-deals/shop-clothing-intimates-1/` → `TodaysDeals_ShopClothingIntimates-1.json`
- `/shoes-accessories/shoes/boots-booties/` → `ShoesAccessories_Shoes_BootsBooties.json`

Boxes without a URL fall back to the lower-cased box name. The name stays editable on each card. Tile destinations are never renamed.

## Cards: identify, delete, drag and drop

- Each card header reads **URL | Category_ID | Category_ID.json** (page URL, content ID, editable file name).
- Tiles are listed on the left; the A–H layout is on the right and updates live.
- **Drag** a tile (grab the ⠿ handle in the list, or drag it in the layout) onto a slot. A 2x1 snaps to the start of its row; dropping onto an occupied slot swaps the two tiles.
- Drops are never auto-corrected: if a move breaks a rule (stacking, overlap) the tile turns amber and the card shows "to fix".
- **×** deletes a tile (removed from the JSON and the xlsx); **Undo delete** on the card brings it back.
- **Asset preview:** when a tile has an asset, the layout shows the creative from `https://cdn.torrid.com/i/torrid/<asset>` (requested at preview size, `?wid=300&fmt=auto`) in place of the dark box. Tiles without an asset, or whose image fails to load, stay plain. The JSON keeps the plain CDN URL. Previews need internet access.

## Current state (the files that are live today)

- **Load current state** → pick the folder of live marketing box JSON files (subfolders included). Each valid file becomes a card; its Category_ID is the file name. Files without a `MarketingTiles` array are skipped and counted.
- Paste a sheet on top: a sheet box updates the current file with the same Category_ID (case, `_` and `-` ignored). **Sheet slots replace whatever the live file has in the same slots; every other slot is kept** ("blank rows retain existing content"). Cards are tagged **Current**, **Updated · n replaced** or **New** (no matching file). Kept tiles say "Kept from current file".
- Inactive tiles (`isActive: false`) and any extra keys in a live file are written back unchanged.
- **Only changed boxes** (on by default) limits the zip and xlsx to New / Updated / hand-edited boxes, so untouched files aren't re-exported. Untick it to export everything.
- **Remove** hides a current file (e.g. test folders); **Clear current** drops the loaded state.

### Built-in current state: 11/19

The **Current state: 11/19** button loads a snapshot of the 46 top-level `.json` files in `2026/11_Nov/19/app/marketing-box` (no subfolders, no review notes). Loaded files are written back exactly as they are, including empty `action`/`destination` values.

The snapshot is a copy (`current-state/2026-11-19.js`). When the folder changes, regenerate it:

```powershell
.\build-current-state.ps1 -Folder "..\..\2026\11_Nov\19\app\marketing-box" -Id "2026-11-19" -Label "11/19 · app/marketing-box"
```

**Load folder…** still lets you pick any other folder (subfolders included).

> **Status: hidden for now.** The current-state buttons and the "Only changed boxes" switch are not shown. Everything is still in the code; add `?current` to the URL (e.g. `index.html?current`) to bring it back, or set `FEATURES.currentState` to `true` in `app.js` to show it permanently.
