/* ===== Noelle West Rental Calculator - app.js ===== */
/* Data source: Google Sheets (live) with localStorage fallback  */

window.latestSubmissionText = '';

/* ─────────────────────────────────────────────
   CONFIGURATION
   ───────────────────────────────────────────── */
const SHEET_ID = '1-QD9UJ99Rjl1JPlBdKPo7hz5MBOiJKkMyD-qWlD520s';

/* Category type rules
   – TRACKED: individual items, no duplicates, searchable dropdown
   – QUANTITY: size+qty workflow, merging, repeatable               */
// "PET-#" is the sheet name for individually tracked petticoat items (PET-01, PET-02…)
// "PET"   is a separate sheet with 3 quantity variants: PET, PET-3 HOOPS, PET-6 HOOPS
const TRACKED_CATS = [
  "BGI","BGS","PGI","PGS","PGC","FIL","MG","CD","MS","CS","S-UPPER","PET-#"
];
const QTY_CATS = [
  "BCPO","BOY","BPSC","BPO","BPOL","BPS","COAT BARONG","BCC","BPOC",
  "VST","POLO","ACC","PEN","PANTS",
  "MOH","BMG","FGG",
  "PET"   // quantity sheet: PET, PET-3 HOOPS, PET-6 HOOPS
];

/* ─────────────────────────────────────────────
   STATE
   ───────────────────────────────────────────── */
const state = {
  items:       [],
  masterItems: [],   // [{category, name, rentalRate, retailPrice, firstUserPrice, type}]
  activeTab:   'tracked',
  loading:     true,
  error:       null
};

/* ─────────────────────────────────────────────
   UTILITIES
   ───────────────────────────────────────────── */
function money(n) {
  if (n == null || isNaN(n)) return '—';
  if (Number(n) === 0) return '₱0 (FREE)';
  return '₱' + Number(n).toLocaleString('en-PH', {minimumFractionDigits:0, maximumFractionDigits:0});
}
function moneyItem(n) {
  // For item amounts: show ₱0 without FREE label
  if (n == null || isNaN(n)) return '₱0';
  return '₱' + Number(n).toLocaleString('en-PH', {minimumFractionDigits:0, maximumFractionDigits:0});
}
function moneyPlain(n) {
  if (n == null || isNaN(n)) return '0.00';
  return Number(n).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function uid()      { return Math.random().toString(36).slice(2,9); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return escHtml(s); }
function showError(el, msg) {
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3500);
}
function cleanPrice(raw) {
  if (raw == null) return null;
  // Strip peso sign, commas, spaces, and any whitespace
  const s = String(raw)
    .replace(/₱/g, '')   // ₱ peso sign
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim();
  if (s === '' || s.toLowerCase() === 'nan') return null;
  const f = parseFloat(s);
  if (isNaN(f)) return null;
  return f >= 0 ? f : null;  // 0 is valid (free item)
}

/* ─────────────────────────────────────────────
   GOOGLE SHEETS → DATA
   ───────────────────────────────────────────── */

/* Fetch one sheet tab as CSV and parse rows */
async function fetchSheetCSV(sheetName) {
  // URL-encode the sheet name for the gid lookup via the named range trick
  // Use the visible sheet name export approach
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Sheet "${sheetName}" fetch failed: ${res.status}`);
  const text = await res.text();
  return parseCSV(text);
}

/* Minimal but robust CSV parser (handles quoted fields with commas/newlines) */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i+1];
    if (inQ) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"')          { inQ = false; }
      else                         { field += c; }
    } else {
      if      (c === '"')          { inQ = true; }
      else if (c === ',')          { row.push(field.trim()); field = ''; }
      else if (c === '\n' || (c === '\r' && n === '\n')) {
        if (c === '\r') i++;
        row.push(field.trim()); rows.push(row); row = []; field = '';
      } else { field += c; }
    }
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

/* Get the list of visible sheet names from the spreadsheet */
async function fetchSheetNames() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const res  = await fetch(url);
  const text = await res.text();
  // Strip Google's JSONP wrapper: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const json = JSON.parse(text.replace(/^[^{]*/, '').replace(/\);?\s*$/, ''));
  return json.table?.cols ? null : null; // not the right endpoint for sheet names
}

/* Build master item list by fetching each known sheet */
async function loadFromGoogleSheets() {
  // We know the sheet names from the workbook + new additions
  const ALL_SHEETS = [
    // Tracked
    "BGS","BGI","PGS","PGI","PGC","FIL","MG","CD","MS","CS","S-UPPER",
    // Quantity (original)
    "BCPO","BOY","BPSC","BPO","BPOL","BPS","COAT BARONG","BCC","BPOC",
    "VST","POLO","ACC","PEN","PANTS",
    // PET-# sheet = tracked individual petticoats (PET-01, PET-02…)
    "PET-#",
    // PET sheet = quantity variants (PET, PET-3 HOOPS, PET-6 HOOPS)
    "PET",
    // New quantity sheets
    "MOH","BMG","FGG"
  ];

  const masterItems = [];

  await Promise.allSettled(ALL_SHEETS.map(async (sheetName) => {
    let rows;
    try {
      rows = await fetchSheetCSV(sheetName);
    } catch(e) {
      console.warn(`Skipping sheet "${sheetName}":`, e.message);
      return;
    }
    if (!rows.length) return;

    // First row = headers
    const headers = rows[0].map(h => h.toUpperCase().trim());
    const nameCol = 0; // always col A
    let rentalCol = -1, retailCol = -1, fuCol = -1;

    headers.forEach((h, i) => {
      if (i === 0) return; // skip name column
      // Broad rental rate detection: catches RENTAL RATE, RENTAL FEE, RENTAL PRICE, RATE, PRICE, AMOUNT, RENTAL
      if (rentalCol === -1 && (
        (h.includes('RENTAL') && (h.includes('RATE') || h.includes('FEE') || h.includes('PRICE'))) ||
        h === 'RENTAL' || h === 'RATE' || h === 'PRICE' || h === 'AMOUNT'
      )) rentalCol = i;
      if (h.includes('RETAIL') && h.includes('PRICE')) retailCol = i;
      if (h.includes('FIRST')  && h.includes('USER'))  fuCol     = i;
    });

    // Last resort: if no rental column found, use col B (simple 2-column sheets)
    if (rentalCol === -1 && headers.length >= 2) rentalCol = 1;

    // Log for debugging (visible in browser console)
    console.log('[' + sheetName + '] headers:', rows[0], '=> rentalCol:', rentalCol, '| retailCol:', retailCol, '| fuCol:', fuCol);
    if (rows[1]) console.log('[' + sheetName + '] row1 sample:', rows[1]);

    // Determine base type for this sheet
    const isQtySheet = QTY_CATS.includes(sheetName);

    for (let r = 1; r < rows.length; r++) {
      const row  = rows[r];
      const name = row[nameCol]?.trim();
      if (!name) continue;

      const rentalRate     = rentalCol >= 0 ? cleanPrice(row[rentalCol]) : null;
      const retailPrice    = retailCol >= 0 ? cleanPrice(row[retailCol]) : null;
      const firstUserPrice = fuCol     >= 0 ? cleanPrice(row[fuCol])     : null;

      // Type is determined purely by which list the sheet name belongs to
      const type = isQtySheet ? 'QUANTITY' : 'TRACKED';

      // For QUANTITY items: blank rental cell = intentionally free (₱0)
      const effectiveRentalRate = (type === 'QUANTITY' && rentalRate == null) ? 0 : rentalRate;

      masterItems.push({ category: sheetName, name, rentalRate: effectiveRentalRate, retailPrice, firstUserPrice, type });
    }
  }));

  return masterItems;
}



/* ─────────────────────────────────────────────
   BOOT / LOAD DATA  (always live, no cache)
   ───────────────────────────────────────────── */
async function loadData() {
  showLoadingState(true);
  try {
    state.masterItems = await loadFromGoogleSheets();
    state.loading = false;
    showLoadingState(false);
    init();
    // Apply saved restore text (captured from JotForm ready event before data loaded)
    const textToRestore = window._savedRestoreText || null;
    if (textToRestore) {
      console.log('[loadData] applying saved restore text');
      window._savedRestoreText = null; // consume it
      await restoreFromSummary(textToRestore);
    }
  } catch(e) {
    console.error('Failed to load from Google Sheets:', e);
    showLoadingState(false, 'Could not load inventory. Please refresh the page.');
  }
}

function showLoadingState(loading, errorMsg) {
  const el = document.getElementById('loading-state');
  if (!el) return;
  if (loading) {
    el.innerHTML = `<div class="loading-spinner">Loading inventory from Google Sheets…</div>`;
    el.style.display = 'block';
  } else if (errorMsg) {
    el.innerHTML = `<div class="loading-error">⚠️ ${errorMsg}</div>`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

/* ─────────────────────────────────────────────
   INIT
   ───────────────────────────────────────────── */
function init() {
  buildTrackedPanel();
  buildQuantityPanel();
  switchTab(state.activeTab);
  renderItems();
}

/* ─────────────────────────────────────────────
   JOTFORM SETUP  (submit + ready/restore)
   ───────────────────────────────────────────── */
const JOTFORM_API_KEY = '63d52d3f1b3632d31de129241f7f6facc';

/* ─────────────────────────────────────────────
   JOTFORM SETUP
   ───────────────────────────────────────────── */
function setupJotform() {
  if (typeof JFCustomWidget === 'undefined') return;

  JFCustomWidget.subscribe('submit', function() {
    updateJotform();
    JFCustomWidget.sendSubmit({ valid: true, value: window.latestSubmissionText || '' });
  });

  JFCustomWidget.subscribe('ready', function(data) {
    console.log('[JotForm ready] fired, value:', data?.value ? data.value.substring(0, 60) : 'none');

    // Extract saved value from ready event
    const raw = data?.value || '';
    if (raw && raw.includes('RENTAL TOTAL:') && !window._savedRestoreText) {
      window._savedRestoreText = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      console.log('[JotForm ready] saved restore text:', window._savedRestoreText.substring(0, 60));
    }

    // Extract sid
    const sid = String(data?.sid || data?.submissionID || data?.submissionId || '');
    if (sid) window._jfSid = sid;
  });

  // postMessage: only capture sid, never restore
  window.addEventListener('message', function(e) {
    try {
      const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (!msg) return;
      const sid = msg.sid || msg.submissionID || msg.submissionId;
      if (sid && !window._jfSid) window._jfSid = String(sid);
    } catch(e) {}
  });
}

function getSubmissionId() {
  try {
    const m = window.parent.location.href.match(/\/edit\/(\d{10,})/);
    if (m) return m[1];
  } catch(e) {}
  return null;
}

function saveToLocalStorage(sid, text) {
  if (!sid || !text) return;
  try { localStorage.setItem('jf_rental_' + sid, text); } catch(e) {}
}

function loadFromLocalStorage(sid) {
  if (!sid) return null;
  try { return localStorage.getItem('jf_rental_' + sid) || null; } catch(e) { return null; }
}

/* ─────────────────────────────────────────────
   RESTORE FROM SAVED SUMMARY
   ───────────────────────────────────────────── */
async function restoreFromSummary(text) {
  if (!text || !text.includes('RENTAL TOTAL:')) {
    console.log('[restore] no valid text to restore');
    return;
  }
  console.log('[restore] starting restore from:', text.substring(0, 80));

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  console.log('[restore] lines:', lines);

  let restored = 0;
  for (const line of lines) {
    if (line.startsWith('RENTAL TOTAL:')) continue;

    // Tracked: "NAME | Rental Rate @ ₱1,000.00 = ₱1,000.00"
    const trackedMatch = line.match(/^(.+?)\s*\|\s*(Rental Rate|First User)\s*@\s*[^\d]*([\d,]+\.?\d*)\s*=\s*[^\d]*([\d,]+\.?\d*)$/);
    if (trackedMatch) {
      const name         = trackedMatch[1].trim();
      const pricingLabel = trackedMatch[2].trim();
      const rate         = parseFloat(trackedMatch[3].replace(/,/g, ''));
      const amount       = parseFloat(trackedMatch[4].replace(/,/g, ''));
      console.log('[restore] tracked:', name, rate, amount);
      const masterItem = state.masterItems.find(i => i.type === 'TRACKED' && i.name === name);
      console.log('[restore] found in master:', !!masterItem);
      if (masterItem) {
        state.items.push({ id: uid(), category: masterItem.category, name, rentalRate: rate, pricingLabel, quantity: 1, amount, type: 'TRACKED' });
        restored++;
      }
      continue;
    }

    // Quantity: "NAME x QTY @ ₱350.00 = ₱1,050.00"
    const qtyMatch = line.match(/^(.+?)\s+x\s+(\d+)\s+@\s+[^\d]*([\d,]+\.?\d*)\s+=\s+[^\d]*([\d,]+\.?\d*)$/);
    if (qtyMatch) {
      const name   = qtyMatch[1].trim();
      const qty    = parseInt(qtyMatch[2]);
      const rate   = parseFloat(qtyMatch[3].replace(/,/g, ''));
      const amount = parseFloat(qtyMatch[4].replace(/,/g, ''));
      console.log('[restore] quantity:', name, qty, rate);
      const masterItem = state.masterItems.find(i => i.type === 'QUANTITY' && i.name === name);
      if (masterItem) {
        state.items.push({ id: uid(), category: masterItem.category, name, rentalRate: rate, pricingLabel: 'Rental Rate', quantity: qty, amount, type: 'QUANTITY' });
        restored++;
      }
      continue;
    }

    console.log('[restore] line did not match any pattern:', line);
  }

  console.log('[restore] restored', restored, 'items');
  buildTrackedPanel();
  buildQuantityPanel();
  switchTab(state.activeTab);
  renderItems();
}
/* ─────────────────────────────────────────────
   TAB SWITCHING
   ───────────────────────────────────────────── */
function switchTab(tab) {
  state.activeTab = tab;
  document.getElementById('tab-tracked').classList.toggle('active', tab === 'tracked');
  document.getElementById('tab-qty').classList.toggle('active',     tab === 'quantity');
  document.getElementById('panel-tracked').style.display = tab === 'tracked'  ? 'block' : 'none';
  document.getElementById('panel-qty').style.display     = tab === 'quantity' ? 'block' : 'none';
}

/* ─────────────────────────────────────────────
   TRACKED PANEL
   ───────────────────────────────────────────── */
function buildTrackedPanel() {
  const panel = document.getElementById('panel-tracked');

  // All TRACKED categories (BGI, BGS … S-UPPER, and PET-# individual petticoats)
  const trackedCats = [...new Set(
    state.masterItems.filter(i => i.type === 'TRACKED').map(i => i.category)
  )].sort();

  const catOpts = trackedCats
    .map(c => `<option value="${c}">${c}</option>`)
    .join('');

  panel.innerHTML = `
    <div class="form-grid">
      <div class="field-group">
        <div class="field-label">Category</div>
        <select id="t-category">
          <option value="">— Select category —</option>
          ${catOpts}
        </select>
      </div>

      <div class="field-group">
        <div class="field-label">Item</div>
        <div class="search-container" id="t-search-wrap">
          <input type="text" class="search-input" id="t-search" placeholder="Search or type item name…" disabled autocomplete="off">
          <div class="search-dropdown" id="t-dropdown"></div>
        </div>
      </div>

      <div id="t-price-selector" class="price-selector" style="display:none">
        <div class="field-label">Pricing Type</div>
        <div class="price-toggle-group">
          <label class="price-toggle-option" id="t-opt-rental">
            <input type="radio" name="t-price-type" value="rental" checked>
            <div class="price-toggle-card">
              <div class="price-toggle-label">Rental Rate</div>
              <div class="price-toggle-amount" id="t-rental-display">—</div>
            </div>
          </label>
          <label class="price-toggle-option" id="t-opt-fu">
            <input type="radio" name="t-price-type" value="firstUser">
            <div class="price-toggle-card">
              <div class="price-toggle-label">First User</div>
              <div class="price-toggle-amount" id="t-fu-display">—</div>
            </div>
          </label>
        </div>
      </div>

      <div class="rate-preview" id="t-rate-preview">
        <span class="rate-label">Rental Rate</span>
        <span class="rate-value empty" id="t-rate-val">Select an item</span>
      </div>

      <button class="btn-add" id="t-add-btn" disabled>Add Item</button>
      <div class="error-msg" id="t-error"></div>
    </div>
  `;

  let selectedItem = null;

  const catEl       = document.getElementById('t-category');
  const searchEl    = document.getElementById('t-search');
  const dropEl      = document.getElementById('t-dropdown');
  const ratePreview = document.getElementById('t-rate-preview');
  const rateEl      = document.getElementById('t-rate-val');
  const priceSelEl  = document.getElementById('t-price-selector');
  const rentalDisp  = document.getElementById('t-rental-display');
  const fuDisp      = document.getElementById('t-fu-display');
  const addBtn      = document.getElementById('t-add-btn');
  const errorEl     = document.getElementById('t-error');

  function getAvailableItems(cat) {
    const used = new Set(
      state.items.filter(i => i.type === 'TRACKED' && i.category === cat).map(i => i.name)
    );
    return state.masterItems.filter(i => i.type === 'TRACKED' && i.category === cat && !used.has(i.name));
  }

  function renderDropdown(items) {
    dropEl.innerHTML = items.length
      ? items.slice(0, 150).map(i =>
          `<div class="dropdown-item" data-name="${escAttr(i.name)}">${escHtml(i.name)}</div>`
        ).join('')
      : '<div class="dropdown-item no-results">No items found</div>';
    dropEl.classList.add('open');
  }

  function closeDropdown() { dropEl.classList.remove('open'); }

  function selectItem(item) {
    selectedItem = item;
    searchEl.value = item.name;
    closeDropdown();
    errorEl.classList.remove('visible');

    const hasRental = item.rentalRate != null;
    const hasFU     = item.firstUserPrice != null && item.firstUserPrice > 0;

    if (hasFU) {
      ratePreview.style.display = 'none';
      priceSelEl.style.display  = 'block';
      rentalDisp.textContent = hasRental ? money(item.rentalRate) : 'No rate';
      fuDisp.textContent     = money(item.firstUserPrice);
      panel.querySelector('input[name="t-price-type"][value="rental"]').checked = true;
      addBtn.disabled = !hasRental;
    } else {
      ratePreview.style.display = '';
      priceSelEl.style.display  = 'none';
      rateEl.textContent = hasRental ? money(item.rentalRate) : 'No rate set';
      rateEl.classList.toggle('empty', !hasRental);
      addBtn.disabled = !hasRental;
    }
  }

  function resetPanel() {
    selectedItem = null;
    searchEl.value = '';
    searchEl.disabled = true;
    catEl.value = '';
    ratePreview.style.display = '';
    priceSelEl.style.display  = 'none';
    rateEl.textContent = 'Select an item';
    rateEl.classList.add('empty');
    addBtn.disabled = true;
    closeDropdown();
  }

  catEl.addEventListener('change', () => {
    selectedItem = null;
    searchEl.value = '';
    searchEl.disabled = !catEl.value;
    ratePreview.style.display = '';
    priceSelEl.style.display  = 'none';
    rateEl.textContent = 'Select an item';
    rateEl.classList.add('empty');
    addBtn.disabled = true;
    closeDropdown();
  });

  searchEl.addEventListener('input', () => {
    selectedItem = null;
    addBtn.disabled = true;
    rateEl.textContent = 'Select an item';
    rateEl.classList.add('empty');
    priceSelEl.style.display  = 'none';
    ratePreview.style.display = '';
    const cat = catEl.value;
    if (!cat) return;
    const q = searchEl.value.trim().toLowerCase();
    const available = getAvailableItems(cat);
    renderDropdown(q ? available.filter(i => i.name.toLowerCase().includes(q)) : available);
  });

  searchEl.addEventListener('focus', () => {
    const cat = catEl.value;
    if (!cat) return;
    const q = searchEl.value.trim().toLowerCase();
    const available = getAvailableItems(cat);
    renderDropdown(q ? available.filter(i => i.name.toLowerCase().includes(q)) : available);
  });

  dropEl.addEventListener('mousedown', (e) => {
    const itEl = e.target.closest('.dropdown-item');
    if (!itEl || itEl.classList.contains('no-results')) return;
    const item = state.masterItems.find(
      i => i.type === 'TRACKED' && i.category === catEl.value && i.name === itEl.dataset.name
    );
    if (item) selectItem(item);
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('t-search-wrap')?.contains(e.target)) closeDropdown();
  });

  priceSelEl.addEventListener('change', (e) => {
    if (!selectedItem || !e.target.matches('input[name="t-price-type"]')) return;
    addBtn.disabled = e.target.value === 'rental'
      ? !(selectedItem.rentalRate != null)
      : !(selectedItem.firstUserPrice > 0);
  });

  addBtn.addEventListener('click', () => {
    if (!selectedItem) return;
    if (state.items.some(i => i.type === 'TRACKED' && i.category === selectedItem.category && i.name === selectedItem.name)) {
      showError(errorEl, `${selectedItem.name} is already in the list.`);
      return;
    }

    const hasFU = selectedItem.firstUserPrice != null && selectedItem.firstUserPrice > 0;
    let chosenRate, pricingLabel;
    if (hasFU) {
      const sel = panel.querySelector('input[name="t-price-type"]:checked');
      if (sel?.value === 'firstUser') {
        chosenRate = selectedItem.firstUserPrice; pricingLabel = 'First User';
      } else {
        chosenRate = selectedItem.rentalRate; pricingLabel = 'Rental Rate';
      }
    } else {
      chosenRate = selectedItem.rentalRate; pricingLabel = 'Rental Rate';
    }

    state.items.push({
      id: uid(), category: selectedItem.category, name: selectedItem.name,
      rentalRate: chosenRate, pricingLabel, quantity: 1, amount: chosenRate, type: 'TRACKED'
    });

    resetPanel();
    renderItems();
  });
}

/* ─────────────────────────────────────────────
   QUANTITY PANEL
   ───────────────────────────────────────────── */
function buildQuantityPanel() {
  const panel = document.getElementById('panel-qty');

  // All QUANTITY items — dedupe categories, keep order
  const qtyCats = [...new Set(
    state.masterItems.filter(i => i.type === 'QUANTITY').map(i => i.category)
  )];

  const catOpts = qtyCats
    .map(c => `<option value="${c}">${c}</option>`)
    .join('');

  panel.innerHTML = `
    <div class="form-grid">
      <div class="input-row qty-layout">
        <div class="field-group">
          <div class="field-label">Category</div>
          <select id="q-category">
            <option value="">— Select —</option>
            ${catOpts}
          </select>
        </div>
        <div class="field-group">
          <div class="field-label">Size / Variant</div>
          <select id="q-size" disabled>
            <option value="">— Select —</option>
          </select>
        </div>
      </div>

      <div class="field-group">
        <div class="field-label">Quantity</div>
        <input type="number" id="q-qty" min="1" value="1" disabled>
      </div>

      <div class="rate-preview">
        <span class="rate-label">Rental Rate</span>
        <span class="rate-value empty" id="q-rate-val">Select an item</span>
      </div>

      <button class="btn-add" id="q-add-btn" disabled>Add Item</button>
      <div class="error-msg" id="q-error"></div>
    </div>
  `;

  const catEl  = document.getElementById('q-category');
  const sizeEl = document.getElementById('q-size');
  const qtyEl  = document.getElementById('q-qty');
  const rateEl = document.getElementById('q-rate-val');
  const addBtn = document.getElementById('q-add-btn');
  const errEl  = document.getElementById('q-error');
  let selectedQtyItem = null;

  catEl.addEventListener('change', () => {
    const cat = catEl.value;
    sizeEl.innerHTML = '<option value="">— Select —</option>';
    sizeEl.disabled = !cat;
    qtyEl.disabled = true;
    addBtn.disabled = true;
    selectedQtyItem = null;
    rateEl.textContent = 'Select an item';
    rateEl.classList.add('empty');
    if (!cat) return;
    state.masterItems.filter(i => i.type === 'QUANTITY' && i.category === cat).forEach(i => {
      const opt = document.createElement('option');
      opt.value = i.name;
      opt.textContent = i.name;
      sizeEl.appendChild(opt);
    });
    sizeEl.disabled = false;
  });

  sizeEl.addEventListener('change', () => {
    const name = sizeEl.value;
    if (!name) {
      selectedQtyItem = null;
      rateEl.textContent = 'Select an item';
      rateEl.classList.add('empty');
      qtyEl.disabled = true;
      addBtn.disabled = true;
      return;
    }
    selectedQtyItem = state.masterItems.find(
      i => i.type === 'QUANTITY' && i.category === catEl.value && i.name === name
    );
    if (selectedQtyItem) {
      const rate = selectedQtyItem.rentalRate;
      const hasRate = rate != null;
      rateEl.textContent = hasRate ? money(rate) : 'No rate set';
      rateEl.classList.toggle('empty', !hasRate);
      qtyEl.disabled  = !hasRate;
      addBtn.disabled = !hasRate;
      if (hasRate) qtyEl.focus();
    }
  });

  addBtn.addEventListener('click', () => {
    if (!selectedQtyItem) return;
    const qty = parseInt(qtyEl.value) || 1;
    if (qty < 1) { showError(errEl, 'Quantity must be at least 1.'); return; }
    const { category: cat, name, rentalRate: rate } = selectedQtyItem;
    const existing = state.items.find(i => i.type === 'QUANTITY' && i.category === cat && i.name === name);
    if (existing) {
      existing.quantity += qty;
      existing.amount = existing.rentalRate * existing.quantity;
    } else {
      state.items.push({
        id: uid(), category: cat, name, rentalRate: rate,
        pricingLabel: 'Rental Rate', quantity: qty, amount: rate * qty, type: 'QUANTITY'
      });
    }
    sizeEl.value = '';
    qtyEl.value  = 1;
    qtyEl.disabled  = true;
    addBtn.disabled = true;
    selectedQtyItem = null;
    rateEl.textContent = 'Select an item';
    rateEl.classList.add('empty');
    errEl.classList.remove('visible');
    renderItems();
  });
}

/* ─────────────────────────────────────────────
   RENDER ITEMS LIST
   ───────────────────────────────────────────── */
function renderItems() {
  const list    = document.getElementById('items-list');
  const emptyEl = document.getElementById('items-empty');
  const countEl = document.getElementById('total-count');
  const totalEl = document.getElementById('total-amount');
  const badge   = document.getElementById('items-badge');

  if (!state.items.length) {
    list.innerHTML = '';
    emptyEl.style.display = 'block';
    totalEl.textContent   = '₱0';
    countEl.textContent   = '0 items';
    if (badge) badge.textContent = '0';
    updateJotform();
    return;
  }

  emptyEl.style.display = 'none';
  let total = 0;

  list.innerHTML = state.items.map(item => {
    total += item.amount || 0;
    const label = item.type === 'QUANTITY' ? `${item.name} ×${item.quantity}` : item.name;
    const meta  = item.type === 'QUANTITY'
      ? `${money(item.rentalRate)} × ${item.quantity}`
      : (item.pricingLabel || 'Rental Rate');
    const fuTag = item.pricingLabel === 'First User'
      ? `<span class="fu-tag">1st User</span>` : '';

    return `
      <div class="rental-item" data-id="${item.id}">
        <div class="item-info">
          <div class="item-name">${escHtml(label)} ${fuTag}</div>
          <div class="item-meta">${escHtml(meta)}</div>
        </div>
        <div class="item-amount">${moneyItem(item.amount)}</div>
        <button class="btn-remove" data-id="${item.id}" title="Remove">✕</button>
      </div>`;
  }).join('');

  totalEl.textContent = money(total);
  const c = state.items.length;
  countEl.textContent = `${c} item${c !== 1 ? 's' : ''}`;
  if (badge) badge.textContent = c;
  updateJotform();
}

/* Remove */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-remove');
  if (!btn) return;
  state.items = state.items.filter(i => i.id !== btn.dataset.id);
  renderItems();
});

/* ─────────────────────────────────────────────
   JOTFORM OUTPUT  →  #input_115
   ───────────────────────────────────────────── */
function updateJotform() {
  const lines = [];
  let grandTotal = 0;

  if (!state.items.length) {
    window.latestSubmissionText = '';
    if (window.JFCustomWidget && typeof JFCustomWidget.sendData === 'function') {
      JFCustomWidget.sendData({ value: '' });
    }
    function writeBlank(doc) {
      const field = doc.querySelector('#input_115');
      if (field) {
        field.value = '';
        field.textContent = '';
        field.dispatchEvent(new Event('input',  { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('keyup',  { bubbles: true }));
        return true;
      }
      return false;
    }
    try { writeBlank(document); }           catch(e) {}
    try { writeBlank(window.parent.document); } catch(e) {}
    try { writeBlank(window.top.document);    } catch(e) {}
    return;
  }

  if (true) {
    state.items.forEach(item => {
      grandTotal += item.amount || 0;
      if (item.type === 'QUANTITY') {
        lines.push(
          `${item.name} x ${item.quantity}` +
          ` @ ₱${moneyPlain(item.rentalRate)}` +
          ` = ₱${moneyPlain(item.amount)}`
        );
      } else {
        lines.push(
          `${item.name} | ${item.pricingLabel || 'Rental Rate'}` +
          ` @ ₱${moneyPlain(item.rentalRate)}` +
          ` = ₱${moneyPlain(item.amount)}`
        );
      }
    });
  }

  lines.push('');
  lines.push(`RENTAL TOTAL: ₱${moneyPlain(grandTotal)}`);

  window.latestSubmissionText = lines.join('\n');

  // Save to localStorage for edit restore
  if (window._jfSid) saveToLocalStorage(window._jfSid, window.latestSubmissionText);

  // Broadcast grand total to total widget
  try {
    window.top.postMessage(JSON.stringify({
      type: 'widgetValue', valid: true,
      value: window.latestSubmissionText,
      grandTotal: grandTotal.toFixed(2),
      source: 'rental_calculator'
    }), '*');
  } catch(e) {}

  // Ping Apps Script with grand total
  try {
    const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwJhhGu_5QfQYmOfswMNZPRGxnKD8PgU5DxKAI6DFCKgPUlU4gX7H-FKLOWoV6Ea65B/exec";
    let sid = "form_242352946598066";
    console.log("[AppScript] rental pinging session:", sid, "total:", grandTotal.toFixed(2));
    fetch(`${APPS_SCRIPT_URL}?action=set&session=${sid}&source=rental&total=${grandTotal.toFixed(2)}`)
      .then(r => r.json())
      .then(d => console.log("[AppScript] rental response:", JSON.stringify(d)))
      .catch(e => console.log("[AppScript] rental error:", e.message));
  } catch(e) { console.log("[AppScript] rental exception:", e.message); }

  // Method 1: JFCustomWidget API
  if (window.JFCustomWidget && typeof JFCustomWidget.sendData === 'function') {
    JFCustomWidget.sendData({ value: window.latestSubmissionText });
  }

  // Method 2: Direct DOM write to #input_115
  function writeToField(doc) {
    const field = doc.querySelector('#input_115');
    if (field) {
      field.value = window.latestSubmissionText;
      field.dispatchEvent(new Event('input',  { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }
  if (!writeToField(document)) {
    try { writeToField(window.parent.document); } catch(e) {}
    try { writeToField(window.top.document);    } catch(e) {}
  }
}

/* ─────────────────────────────────────────────
   BOOT
   ───────────────────────────────────────────── */

// Poll for JFCustomWidget (JotForm injects it asynchronously)
const waitForJotform = () => new Promise(resolve => {
  if (typeof JFCustomWidget !== 'undefined') { resolve(); return; }
  const interval = setInterval(() => {
    if (typeof JFCustomWidget !== 'undefined') { clearInterval(interval); resolve(); }
  }, 50);
  // Give up after 5s (standalone / preview mode)
  setTimeout(() => { clearInterval(interval); resolve(); }, 5000);
});

(async () => {
  await waitForJotform();
  setupJotform();
  await loadData();
})();
