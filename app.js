/* ===== Noelle West Rental Calculator - app.js ===== */

window.latestSubmissionText = '';

/* ---------- State ---------- */
const state = {
  items:       [],
  masterItems: [],
  sizesMap:    {},
  activeTab:   'tracked'
};

/* ---------- Constants ---------- */
const TRACKED_CATS = ["BGI","BGS","PGI","PGS","PGC","FIL","MG","CD","MS","CS","PET","S-UPPER"];
const QTY_CATS     = ["BCPO","BOY","BPSC","BPO","BPOL","BPS","COAT BARONG","BCC","BPOC","VST","POLO","ACC","PEN","PANTS"];

/* ---------- Utility ---------- */
function money(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function uid()      { return Math.random().toString(36).slice(2, 9); }
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return escHtml(s); }
function showError(el, msg) {
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3000);
}

/* ---------- Load Data ---------- */
async function loadData() {
  const [itemsRes, sizesRes] = await Promise.all([
    fetch('master-items.json'),
    fetch('sizes.json')
  ]);
  state.masterItems = await itemsRes.json();
  state.sizesMap    = await sizesRes.json();
  init();
}

/* ---------- Init ---------- */
function init() {
  buildTrackedPanel();
  buildQuantityPanel();
  switchTab(state.activeTab);
  renderItems();
  if (window.JFCustomWidget) {
    JFCustomWidget.subscribe('submit', function() {
      updateJotform(); // ensure latest text is flushed
      JFCustomWidget.sendSubmit({ valid: true, value: window.latestSubmissionText || 'No items selected' });
    });
  }
}

/* ---------- Tab switching ---------- */
function switchTab(tab) {
  state.activeTab = tab;
  document.getElementById('tab-tracked').classList.toggle('active', tab === 'tracked');
  document.getElementById('tab-qty').classList.toggle('active',     tab === 'quantity');
  document.getElementById('panel-tracked').style.display = tab === 'tracked'  ? 'block' : 'none';
  document.getElementById('panel-qty').style.display     = tab === 'quantity' ? 'block' : 'none';
}

/* =============================================
   TRACKED PANEL
   ============================================= */
function buildTrackedPanel() {
  const panel = document.getElementById('panel-tracked');

  const catOpts = TRACKED_CATS
    .filter(c => state.masterItems.some(i => i.category === c))
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

      <!-- Pricing selector: hidden until item with FU price is selected -->
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

      <!-- Rate preview: shown when item has NO FU price (rental only) -->
      <div class="rate-preview" id="t-rate-preview">
        <span class="rate-label">Rental Rate</span>
        <span class="rate-value empty" id="t-rate-val">Select an item</span>
      </div>

      <button class="btn-add" id="t-add-btn" disabled>Add Item</button>
      <div class="error-msg" id="t-error"></div>
    </div>
  `;

  let selectedItem = null;

  const catEl        = document.getElementById('t-category');
  const searchEl     = document.getElementById('t-search');
  const dropEl       = document.getElementById('t-dropdown');
  const ratePreview  = document.getElementById('t-rate-preview');
  const rateEl       = document.getElementById('t-rate-val');
  const priceSelEl   = document.getElementById('t-price-selector');
  const rentalDisp   = document.getElementById('t-rental-display');
  const fuDisp       = document.getElementById('t-fu-display');
  const addBtn       = document.getElementById('t-add-btn');
  const errorEl      = document.getElementById('t-error');

  function getAvailableItems(cat) {
    const usedNames = state.items
      .filter(i => i.type === 'TRACKED' && i.category === cat)
      .map(i => i.name);
    return state.masterItems.filter(i => i.category === cat && !usedNames.includes(i.name));
  }

  function renderDropdown(items) {
    dropEl.innerHTML = items.length
      ? items.slice(0, 120).map(i =>
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

    const hasRental = item.rentalRate && item.rentalRate > 0;
    const hasFU     = item.firstUserPrice && item.firstUserPrice > 0;

    if (hasFU) {
      // Show toggle selector, hide simple preview
      ratePreview.style.display = 'none';
      priceSelEl.style.display  = 'block';
      rentalDisp.textContent = hasRental ? money(item.rentalRate) : 'No rate';
      fuDisp.textContent     = money(item.firstUserPrice);
      // Default to rental rate radio
      panel.querySelector('input[name="t-price-type"][value="rental"]').checked = true;
      addBtn.disabled = !hasRental;
    } else {
      // Simple preview only
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
    priceSelEl.style.display = 'none';
    ratePreview.style.display = '';
    const cat = catEl.value;
    if (!cat) return;
    const q = searchEl.value.trim().toLowerCase();
    const available = getAvailableItems(cat);
    const filtered = q ? available.filter(i => i.name.toLowerCase().includes(q)) : available;
    renderDropdown(filtered);
  });

  searchEl.addEventListener('focus', () => {
    const cat = catEl.value;
    if (!cat) return;
    const q = searchEl.value.trim().toLowerCase();
    const available = getAvailableItems(cat);
    const filtered = q ? available.filter(i => i.name.toLowerCase().includes(q)) : available;
    renderDropdown(filtered);
  });

  dropEl.addEventListener('mousedown', (e) => {
    const itEl = e.target.closest('.dropdown-item');
    if (!itEl || itEl.classList.contains('no-results')) return;
    const name = itEl.dataset.name;
    const item = state.masterItems.find(i => i.category === catEl.value && i.name === name);
    if (item) selectItem(item);
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('t-search-wrap').contains(e.target)) closeDropdown();
  });

  // Radio change: re-validate add button
  priceSelEl.addEventListener('change', (e) => {
    if (!selectedItem || !e.target.matches('input[name="t-price-type"]')) return;
    const type = e.target.value;
    if (type === 'rental') {
      addBtn.disabled = !(selectedItem.rentalRate && selectedItem.rentalRate > 0);
    } else {
      addBtn.disabled = !(selectedItem.firstUserPrice && selectedItem.firstUserPrice > 0);
    }
  });

  addBtn.addEventListener('click', () => {
    if (!selectedItem) return;
    const alreadyAdded = state.items.some(
      i => i.type === 'TRACKED' && i.category === selectedItem.category && i.name === selectedItem.name
    );
    if (alreadyAdded) { showError(errorEl, `${selectedItem.name} is already in the list.`); return; }

    // Determine chosen rate
    const hasFU = selectedItem.firstUserPrice && selectedItem.firstUserPrice > 0;
    let chosenRate, pricingLabel;
    if (hasFU) {
      const sel = panel.querySelector('input[name="t-price-type"]:checked');
      if (sel && sel.value === 'firstUser') {
        chosenRate   = selectedItem.firstUserPrice;
        pricingLabel = 'First User';
      } else {
        chosenRate   = selectedItem.rentalRate;
        pricingLabel = 'Rental Rate';
      }
    } else {
      chosenRate   = selectedItem.rentalRate;
      pricingLabel = 'Rental Rate';
    }

    state.items.push({
      id:           uid(),
      category:     selectedItem.category,
      name:         selectedItem.name,
      displayName:  selectedItem.name,
      rentalRate:   chosenRate,
      pricingLabel: pricingLabel,
      quantity:     1,
      amount:       chosenRate,
      type:         'TRACKED'
    });

    resetPanel();
    renderItems();
  });
}

/* =============================================
   QUANTITY PANEL
   ============================================= */
function buildQuantityPanel() {
  const panel = document.getElementById('panel-qty');

  const catOpts = QTY_CATS
    .filter(c => state.masterItems.some(i => i.category === c))
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
            <option value="">— Select size —</option>
          </select>
        </div>
      </div>

      <div class="field-group">
        <div class="field-label">Quantity</div>
        <input type="number" id="q-qty" min="1" value="1" disabled>
      </div>

      <div class="rate-preview" id="q-rate-preview">
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
    sizeEl.innerHTML = '<option value="">— Select size —</option>';
    sizeEl.disabled = !cat;
    qtyEl.disabled = true;
    addBtn.disabled = true;
    selectedQtyItem = null;
    rateEl.textContent = 'Select an item';
    rateEl.classList.add('empty');
    if (!cat) return;
    state.masterItems.filter(i => i.category === cat).forEach(i => {
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
    selectedQtyItem = state.masterItems.find(i => i.category === catEl.value && i.name === name);
    if (selectedQtyItem) {
      const rate = selectedQtyItem.rentalRate;
      rateEl.textContent = rate ? money(rate) : 'No rate set';
      rateEl.classList.toggle('empty', !rate);
      qtyEl.disabled  = !rate;
      addBtn.disabled = !rate;
      if (rate) qtyEl.focus();
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
      state.items.push({ id: uid(), category: cat, name, displayName: name, rentalRate: rate, pricingLabel: 'Rental Rate', quantity: qty, amount: rate * qty, type: 'QUANTITY' });
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

/* =============================================
   RENDER ITEMS LIST
   ============================================= */
function renderItems() {
  const list    = document.getElementById('items-list');
  const emptyEl = document.getElementById('items-empty');
  const countEl = document.getElementById('total-count');
  const totalEl = document.getElementById('total-amount');
  const badge   = document.getElementById('items-badge');

  if (!state.items.length) {
    list.innerHTML = '';
    emptyEl.style.display   = 'block';
    totalEl.textContent     = '₱0';
    countEl.textContent     = '0 items';
    if (badge) badge.textContent = '0';
    updateJotform();
    return;
  }

  emptyEl.style.display = 'none';
  let total = 0;

  list.innerHTML = state.items.map(item => {
    total += item.amount || 0;
    const label = item.type === 'QUANTITY'
      ? `${item.name} ×${item.quantity}`
      : item.name;

    // Meta: show pricing label for tracked items
    let meta = '';
    if (item.type === 'QUANTITY') {
      meta = `${money(item.rentalRate)} × ${item.quantity}`;
    } else {
      meta = item.pricingLabel || 'Rental Rate';
    }

    // Tag for first user pricing
    const fuTag = (item.pricingLabel === 'First User')
      ? `<span class="fu-tag">1st User</span>`
      : '';

    return `
      <div class="rental-item" data-id="${item.id}">
        <div class="item-info">
          <div class="item-name">${escHtml(label)} ${fuTag}</div>
          <div class="item-meta">${escHtml(meta)}</div>
        </div>
        <div class="item-amount">${money(item.amount)}</div>
        <button class="btn-remove" data-id="${item.id}" title="Remove">✕</button>
      </div>
    `;
  }).join('');

  totalEl.textContent = money(total);
  const c = state.items.length;
  countEl.textContent = `${c} item${c !== 1 ? 's' : ''}`;
  if (badge) badge.textContent = c;
  updateJotform();
}

/* ---------- Remove ---------- */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-remove');
  if (!btn) return;
  state.items = state.items.filter(i => i.id !== btn.dataset.id);
  renderItems();
});

/* =============================================
   JOTFORM OUTPUT
   ============================================= */
function moneyPlain(n) {
  // Same as money() but without the ₱ prefix, for inline use
  if (n === null || n === undefined || isNaN(n)) return '0.00';
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function updateJotform() {
  const lines = [];
  let grandTotal = 0;

  lines.push('RENTAL ITEMS:');
  lines.push('');

  if (state.items.length === 0) {
    lines.push('No items selected');
  } else {
    state.items.forEach(item => {
      grandTotal += item.amount || 0;

      if (item.type === 'QUANTITY') {
        // e.g.  BOY-L x 3 @ ₱350.00 = ₱1,050.00
        lines.push(
          `${item.name} x ${item.quantity}` +
          ` @ ₱${moneyPlain(item.rentalRate)}` +
          ` = ₱${moneyPlain(item.amount)}`
        );
      } else {
        // e.g.  BGI-10000 | Rental Rate @ ₱3,500.00 = ₱3,500.00
        //   or  BGI-10000 | First User  @ ₱4,500.00 = ₱4,500.00
        const priceType = item.pricingLabel || 'Rental Rate';
        lines.push(
          `${item.name} | ${priceType}` +
          ` @ ₱${moneyPlain(item.rentalRate)}` +
          ` = ₱${moneyPlain(item.amount)}`
        );
      }
    });
  }

  lines.push('');
  lines.push(`RENTAL TOTAL: ₱${moneyPlain(grandTotal)}`);

  window.latestSubmissionText = lines.join('\n');

  // ── Method 1: JFCustomWidget API (widget field) ──
  if (window.JFCustomWidget && typeof JFCustomWidget.sendData === 'function') {
    JFCustomWidget.sendData({ value: window.latestSubmissionText });
  }

  // ── Method 2: Direct DOM write to #input_115 ──
  // Works when the widget is embedded in an iframe on the same Jotform page,
  // or when loaded directly in the page. Tries own document first, then parent.
  function writeToField(doc) {
    const field = doc.querySelector('#input_115');
    if (field) {
      field.value = window.latestSubmissionText;
      // Fire native input + change events so Jotform's own listeners pick it up
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

/* ---------- Boot ---------- */
loadData();
