(() => {
  const $ = selector => document.querySelector(selector);
  const board = $('#board');
  const layer = $('#itemsLayer');
  const groupsLayer = $('#groupsLayer');
  const canvas = $('#doodleCanvas');
  const ctx = canvas.getContext('2d');
  const form = $('#noteForm');
  const input = $('#noteInput');
  const count = $('#noteCount');
  const savedCount = $('#savedCount');
  const empty = $('#emptyState');
  const doodleBtn = $('#doodleBtn');
  const eraserBtn = $('#eraserBtn');
  const saveBtn = $('#saveBtn');
  const selectBtn = $('#selectBtn');
  const arrowBtn = $('#arrowBtn');
  const tidyBtn = $('#tidyBtn');
  const undoBtn = $('#undoBtn');
  const clearBtn = $('#clearBtn');
  const hint = $('#modeHint');
  const savedBtn = $('#savedBtn');
  const savedDrawer = $('#savedDrawer');
  const savedList = $('#savedList');
  const selectionDock = $('#selectionDock');
  const selectionTitle = $('#selectionTitle');
  const selectionCount = $('#selectionCount');
  const batchTools = $('#batchTools');
  const archiveSelectedBtn = $('#archiveSelectedBtn');
  const tagInput = $('#tagInput');

  const STORAGE_KEY = 'notesguy-board-v2';
  const LEGACY_KEY = 'notesguy-board-v1';
  const colors = { yellow: '#f8df66', pink: '#f4a6b9', blue: '#9ed8e8' };
  let selectedColor = 'yellow';
  let state = { notes: [], arrows: [], groups: [], saved: [], doodle: '', updatedAt: 0 };
  let history = [];
  let selected = new Set();
  let selectionMode = null;
  let activeNoteId = null;
  let noteDoodleId = null;
  let canvasMode = null;
  let drawing = false;
  let noteDrawing = null;
  let clearArmed = false;
  let drag = null;
  let suppressClickUntil = 0;
  let resizeTimer;
  let syncTimer;
  let syncPaused = false;

  const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const snapshot = () => JSON.stringify(state);

  function remember() {
    history.push(snapshot());
    if (history.length > 30) history.shift();
    undoBtn.disabled = false;
  }

  function starterState() {
    return {
      notes: [
        { id: uid(), text: 'What if ideas felt more like play?', color: 'yellow', x: .08, y: .12, tilt: -4, tag: '', doodle: '' },
        { id: uid(), text: 'messy first.\nuseful later.', color: 'pink', x: .39, y: .43, tilt: 3, tag: 'process', doodle: '' },
        { id: uid(), text: 'Build the weird version →', color: 'blue', x: .67, y: .16, tilt: -2, tag: '', doodle: '' }
      ],
      arrows: [{ id: uid(), x: .58, y: .53, turn: -18 }],
      groups: [], saved: [], doodle: '', updatedAt: 0
    };
  }

  function normalize(raw) {
    const next = raw && typeof raw === 'object' ? raw : starterState();
    next.notes = Array.isArray(next.notes) ? next.notes : [];
    next.arrows = Array.isArray(next.arrows) ? next.arrows : [];
    next.groups = Array.isArray(next.groups) ? next.groups : [];
    next.saved = Array.isArray(next.saved) ? next.saved : [];
    next.doodle = typeof next.doodle === 'string' ? next.doodle : '';
    next.updatedAt = Number(next.updatedAt) || 0;
    next.notes.forEach(note => {
      note.tag = note.tag || '';
      note.doodle = note.doodle || '';
      note.groupId = note.groupId || '';
    });
    next.saved.forEach(note => {
      note.tag = note.tag || '';
      note.doodle = note.doodle || '';
    });
    return next;
  }

  function loadLocal() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
      state = normalize(saved ? JSON.parse(saved) : starterState());
    } catch (_) { state = starterState(); }
  }

  function save({ touch = true } = {}) {
    if (touch) state.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, snapshot()); } catch (_) {}
    if (syncPaused) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushRemote, 450);
  }

  async function pushRemote() {
    try {
      await fetch('/api/state', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: snapshot()
      });
    } catch (_) {}
  }

  async function hydrateRemote() {
    try {
      const response = await fetch('/api/state', { headers: { accept: 'application/json' } });
      if (response.status === 204) { pushRemote(); return; }
      if (!response.ok) return;
      const payload = await response.json();
      const remote = normalize(payload.state);
      if (remote.updatedAt >= state.updatedAt) {
        syncPaused = true;
        state = remote;
        try { localStorage.setItem(STORAGE_KEY, snapshot()); } catch (_) {}
        render(); restoreDoodle(); syncPaused = false;
      } else pushRemote();
    } catch (_) {}
  }

  function updateUI() {
    count.textContent = state.notes.length;
    savedCount.textContent = state.saved.length;
    empty.hidden = state.notes.length + state.arrows.length > 0;
    undoBtn.disabled = history.length === 0;
    selectionCount.textContent = selected.size;
    archiveSelectedBtn.disabled = selected.size === 0;
    $('#groupBtn').disabled = selected.size < 2;
  }

  function render() {
    layer.replaceChildren();
    state.arrows.forEach(renderArrow);
    state.notes.forEach(renderNote);
    renderSaved();
    updateSelectionDock();
    updateUI();
    requestAnimationFrame(renderGroups);
  }

  function renderNote(note) {
    const el = document.createElement('article');
    el.className = 'sticky';
    if (selected.has(note.id)) el.classList.add('is-selected');
    if (note.y > .54) el.classList.add('toolbar-above');
    el.dataset.id = note.id;
    el.dataset.kind = 'note';
    el.dataset.color = note.color;
    el.style.left = `${note.x * 100}%`;
    el.style.top = `${note.y * 100}%`;
    el.style.setProperty('--tilt', `${note.tilt}deg`);
    el.innerHTML = '<button class="delete-note" type="button" aria-label="Delete note">×</button><canvas class="note-ink" aria-label="Note doodle layer"></canvas><div class="sticky-text" tabindex="0"></div>';
    const text = el.querySelector('.sticky-text');
    text.textContent = note.text;
    if (note.tag) {
      const tag = document.createElement('span');
      tag.className = 'note-tag';
      tag.textContent = `#${note.tag}`;
      el.appendChild(tag);
    }
    if (activeNoteId === note.id && !selectionMode && !canvasMode) el.appendChild(buildNoteToolbar(note, text));
    const ink = el.querySelector('.note-ink');
    if (noteDoodleId === note.id) ink.classList.add('is-active');
    el.addEventListener('pointerdown', startDrag);
    el.addEventListener('click', event => {
      if (Date.now() < suppressClickUntil || event.target.closest('button') || event.target.closest('.note-ink') || event.target.contentEditable === 'true') return;
      if (selectionMode) { toggleSelected(note.id); return; }
      activeNoteId = activeNoteId === note.id ? null : note.id;
      noteDoodleId = null;
      render();
    });
    text.addEventListener('dblclick', event => {
      if (selectionMode || canvasMode) return;
      event.stopPropagation();
      beginEditing(text);
    });
    text.addEventListener('blur', () => finishEditing(note, text));
    text.addEventListener('keydown', event => {
      if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter')) text.blur();
    });
    el.querySelector('.delete-note').addEventListener('pointerdown', event => event.stopPropagation());
    el.querySelector('.delete-note').addEventListener('click', event => {
      event.stopPropagation(); remember();
      state.notes = state.notes.filter(item => item.id !== note.id);
      cleanGroups(); activeNoteId = null; render(); save();
    });
    layer.appendChild(el);
    requestAnimationFrame(() => prepareNoteCanvas(note, ink));
  }

  function buildNoteToolbar(note, text) {
    const toolbar = document.createElement('div');
    toolbar.className = 'note-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Note options');
    toolbar.addEventListener('pointerdown', event => event.stopPropagation());
    toolbar.addEventListener('click', event => event.stopPropagation());
    const edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = 'Edit';
    edit.addEventListener('click', () => beginEditing(text));
    toolbar.appendChild(edit);
    Object.keys(colors).forEach(color => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `toolbar-color ${color}`;
      button.setAttribute('aria-label', `Change note to ${color}`);
      button.addEventListener('click', () => { remember(); note.color = color; render(); save(); });
      toolbar.appendChild(button);
    });
    const doodle = document.createElement('button');
    doodle.type = 'button';
    doodle.classList.toggle('is-active', noteDoodleId === note.id);
    doodle.textContent = 'Doodle';
    doodle.addEventListener('click', () => {
      noteDoodleId = noteDoodleId === note.id ? null : note.id;
      render();
      hint.textContent = noteDoodleId ? 'Draw right on this note. Tap Doodle again when done.' : 'Tap a note for its options.';
    });
    toolbar.appendChild(doodle);
    return toolbar;
  }

  function beginEditing(text) {
    noteDoodleId = null;
    text.contentEditable = 'true'; text.focus();
    const range = document.createRange();
    range.selectNodeContents(text); range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  }

  function finishEditing(note, text) {
    if (text.contentEditable !== 'true') return;
    const next = text.textContent.trim() || 'untitled thought';
    if (next !== note.text) remember();
    note.text = next; text.textContent = note.text; text.contentEditable = 'false'; save();
  }

  function prepareNoteCanvas(note, ink) {
    const ratio = window.devicePixelRatio || 1;
    ink.width = Math.max(1, Math.round(ink.clientWidth * ratio));
    ink.height = Math.max(1, Math.round(ink.clientHeight * ratio));
    const noteCtx = ink.getContext('2d');
    if (note.doodle) {
      const image = new Image();
      image.onload = () => noteCtx.drawImage(image, 0, 0, ink.width, ink.height);
      image.src = note.doodle;
    }
    ink.addEventListener('pointerdown', event => {
      if (noteDoodleId !== note.id) return;
      event.stopPropagation(); remember(); ink.setPointerCapture(event.pointerId);
      const point = localCanvasPoint(ink, event);
      noteCtx.beginPath(); noteCtx.moveTo(point.x, point.y);
      noteDrawing = { ink, ctx: noteCtx, note };
    });
    ink.addEventListener('pointermove', event => {
      if (!noteDrawing || noteDrawing.ink !== ink) return;
      const point = localCanvasPoint(ink, event);
      noteCtx.lineTo(point.x, point.y);
      noteCtx.strokeStyle = '#202020'; noteCtx.lineWidth = 2.5 * ratio;
      noteCtx.lineCap = 'round'; noteCtx.lineJoin = 'round'; noteCtx.stroke();
    });
    const finish = event => {
      if (!noteDrawing || noteDrawing.ink !== ink) return;
      event.stopPropagation(); note.doodle = ink.toDataURL('image/png'); noteDrawing = null; save();
    };
    ink.addEventListener('pointerup', finish);
    ink.addEventListener('pointercancel', finish);
  }

  function renderArrow(arrow) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'arrow-sticker';
    el.dataset.id = arrow.id; el.dataset.kind = 'arrow';
    el.setAttribute('aria-label', 'Movable arrow. Double-click to remove.');
    el.textContent = '↗'; el.style.left = `${arrow.x * 100}%`; el.style.top = `${arrow.y * 100}%`;
    el.style.setProperty('--turn', `${arrow.turn}deg`);
    el.addEventListener('pointerdown', startDrag);
    el.addEventListener('dblclick', () => {
      remember(); state.arrows = state.arrows.filter(item => item.id !== arrow.id); render(); save();
    });
    layer.appendChild(el);
  }

  function renderGroups() {
    groupsLayer.replaceChildren();
    const boardRect = board.getBoundingClientRect();
    state.groups.forEach(group => {
      const elements = group.noteIds.map(id => layer.querySelector(`[data-kind="note"][data-id="${CSS.escape(id)}"]`)).filter(Boolean);
      if (elements.length < 2) return;
      const rects = elements.map(element => element.getBoundingClientRect());
      const left = Math.min(...rects.map(rect => rect.left)) - boardRect.left - 12;
      const top = Math.min(...rects.map(rect => rect.top)) - boardRect.top - 12;
      const right = Math.max(...rects.map(rect => rect.right)) - boardRect.left + 12;
      const bottom = Math.max(...rects.map(rect => rect.bottom)) - boardRect.top + 12;
      const box = document.createElement('div');
      box.className = 'group-box';
      box.style.left = `${Math.max(1, left)}px`; box.style.top = `${Math.max(1, top)}px`;
      box.style.width = `${Math.min(boardRect.width - Math.max(1, left) - 2, right - left)}px`;
      box.style.height = `${Math.min(boardRect.height - Math.max(1, top) - 2, bottom - top)}px`;
      box.style.setProperty('--group-color', colors[group.color] || colors.yellow);
      const label = document.createElement('span');
      label.className = 'group-label'; label.textContent = group.tag ? `#${group.tag}` : 'idea group';
      box.appendChild(label); groupsLayer.appendChild(box);
    });
  }

  function renderSaved() {
    savedList.replaceChildren();
    if (!state.saved.length) {
      const message = document.createElement('p');
      message.className = 'saved-empty';
      message.textContent = 'Nothing tucked away yet. Hit Save, then pick a few notes.';
      savedList.appendChild(message); return;
    }
    [...state.saved].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).forEach((note, index) => {
      const card = document.createElement('article');
      card.className = 'saved-card'; card.dataset.color = note.color;
      card.style.setProperty('--saved-tilt', `${index % 2 ? 1 : -1}deg`);
      const text = document.createElement('p'); text.textContent = note.text;
      const footer = document.createElement('footer');
      const meta = document.createElement('small');
      meta.textContent = note.tag ? `#${note.tag}` : formatSavedDate(note.savedAt);
      const actions = document.createElement('div');
      const restore = document.createElement('button');
      restore.type = 'button'; restore.textContent = 'Restore ↗';
      restore.addEventListener('click', () => restoreSaved(note.id));
      const discard = document.createElement('button');
      discard.type = 'button'; discard.className = 'discard-saved';
      discard.setAttribute('aria-label', 'Delete saved note'); discard.textContent = '×';
      discard.addEventListener('click', () => discardSaved(note.id));
      actions.append(restore, discard); footer.append(meta, actions); card.append(text, footer); savedList.appendChild(card);
    });
  }

  function formatSavedDate(timestamp) {
    if (!timestamp) return 'saved note';
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp));
  }

  function startDrag(event) {
    if (canvasMode || selectionMode || noteDoodleId || event.target.closest('button') || event.target.contentEditable === 'true' || event.target.closest('.note-ink')) return;
    const el = event.currentTarget;
    const item = state[el.dataset.kind === 'note' ? 'notes' : 'arrows'].find(entry => entry.id === el.dataset.id);
    if (!item) return;
    event.preventDefault(); remember();
    const rect = el.getBoundingClientRect();
    drag = { el, item, dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false, startX: event.clientX, startY: event.clientY };
    el.classList.add('is-dragging'); el.setPointerCapture(event.pointerId);
    el.addEventListener('pointermove', moveDrag);
    el.addEventListener('pointerup', endDrag, { once: true });
    el.addEventListener('pointercancel', endDrag, { once: true });
  }

  function moveDrag(event) {
    if (!drag) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
    const bounds = board.getBoundingClientRect();
    const x = clamp(event.clientX - bounds.left - drag.dx, 0, bounds.width - drag.el.offsetWidth);
    const y = clamp(event.clientY - bounds.top - drag.dy, 0, bounds.height - drag.el.offsetHeight);
    drag.item.x = x / bounds.width; drag.item.y = y / bounds.height;
    drag.el.style.left = `${drag.item.x * 100}%`; drag.el.style.top = `${drag.item.y * 100}%`;
    renderGroups();
  }

  function endDrag(event) {
    if (!drag) return;
    if (drag.moved) suppressClickUntil = Date.now() + 300;
    drag.el.classList.remove('is-dragging'); drag.el.removeEventListener('pointermove', moveDrag);
    try { drag.el.releasePointerCapture(event.pointerId); } catch (_) {}
    drag = null; save();
  }

  function addNote(text) {
    remember();
    const offset = state.notes.length % 6;
    state.notes.push({
      id: uid(), text, color: selectedColor,
      x: clamp(.12 + offset * .105, .02, .72), y: clamp(.11 + (offset % 3) * .16, .03, .67),
      tilt: [-4, 2, -1, 4, -3, 1][offset], tag: '', doodle: '', groupId: ''
    });
    render(); save();
  }

  function toggleSelected(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    activeNoteId = null; render();
  }

  function setSelectionMode(mode) {
    selectionMode = selectionMode === mode ? null : mode;
    selected.clear(); activeNoteId = null; noteDoodleId = null; setCanvasMode(null);
    saveBtn.setAttribute('aria-pressed', String(selectionMode === 'save'));
    selectBtn.setAttribute('aria-pressed', String(selectionMode === 'select'));
    hint.textContent = selectionMode === 'save' ? 'Tap the notes you want to tuck away.' : selectionMode === 'select' ? 'Tap notes, then group, tag, or recolor them.' : 'Tap a note for options. Drag to move it.';
    render();
  }

  function updateSelectionDock() {
    selectionDock.hidden = !selectionMode;
    if (!selectionMode) return;
    const saving = selectionMode === 'save';
    selectionTitle.textContent = saving ? 'Pick notes to save' : 'Pick notes to change';
    batchTools.hidden = saving; archiveSelectedBtn.hidden = !saving;
  }

  function applyToSelected(action) {
    if (!selected.size) return;
    remember(); state.notes.filter(note => selected.has(note.id)).forEach(action); render(); save();
  }

  function groupSelected() {
    if (selected.size < 2) return;
    remember();
    const ids = [...selected];
    const notes = state.notes.filter(note => selected.has(note.id));
    state.groups.forEach(group => { group.noteIds = group.noteIds.filter(id => !selected.has(id)); });
    cleanGroups();
    const id = uid();
    const tag = tagInput.value.trim().replace(/^#/, '') || `group ${state.groups.length + 1}`;
    notes.forEach(note => { note.groupId = id; if (!note.tag && tagInput.value.trim()) note.tag = tag; });
    state.groups.push({ id, noteIds: ids, tag, color: notes[0]?.color || 'yellow' });
    selected.clear(); tagInput.value = ''; render(); save();
    hint.textContent = 'Grouped! The dashed box keeps these thoughts connected.';
  }

  function cleanGroups() {
    const activeIds = new Set(state.notes.map(note => note.id));
    state.groups.forEach(group => { group.noteIds = group.noteIds.filter(id => activeIds.has(id)); });
    state.groups = state.groups.filter(group => group.noteIds.length > 1);
  }

  function archiveSelected() {
    if (!selected.size) return;
    remember();
    const now = Date.now();
    const moving = state.notes.filter(note => selected.has(note.id)).map(note => ({ ...note, savedAt: now, groupId: '' }));
    state.saved.push(...moving);
    state.notes = state.notes.filter(note => !selected.has(note.id));
    cleanGroups();
    const moved = moving.length;
    setSelectionMode(null); render(); save(); openSaved();
    hint.textContent = `${moved} note${moved === 1 ? '' : 's'} saved for later.`;
  }

  function restoreSaved(id) {
    const note = state.saved.find(item => item.id === id);
    if (!note) return;
    remember();
    const offset = state.notes.length % 5;
    state.notes.push({ ...note, x: .08 + offset * .12, y: .1 + (offset % 3) * .16, savedAt: undefined, groupId: '' });
    state.saved = state.saved.filter(item => item.id !== id);
    render(); save(); hint.textContent = 'That thought is back on the board.';
  }

  function discardSaved(id) {
    remember(); state.saved = state.saved.filter(item => item.id !== id); render(); save();
  }

  function openSaved() {
    savedDrawer.hidden = false; savedBtn.setAttribute('aria-expanded', 'true'); renderSaved();
  }
  function closeSaved() {
    savedDrawer.hidden = true; savedBtn.setAttribute('aria-expanded', 'false');
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addNote(text); input.value = ''; input.focus();
  });

  document.querySelectorAll('.swatch').forEach(button => {
    button.addEventListener('click', () => {
      selectedColor = button.dataset.color;
      document.querySelectorAll('.swatch').forEach(swatch => swatch.classList.toggle('is-selected', swatch === button));
      input.style.background = colors[selectedColor]; input.focus();
    });
  });

  document.querySelectorAll('[data-batch-color]').forEach(button => {
    button.addEventListener('click', () => applyToSelected(note => { note.color = button.dataset.batchColor; }));
  });
  $('#tagBtn').addEventListener('click', () => {
    const tag = tagInput.value.trim().replace(/^#/, '');
    if (!tag) return;
    applyToSelected(note => { note.tag = tag; }); tagInput.value = '';
  });
  tagInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('#tagBtn').click(); } });
  $('#groupBtn').addEventListener('click', groupSelected);
  archiveSelectedBtn.addEventListener('click', archiveSelected);
  $('#cancelSelectionBtn').addEventListener('click', () => setSelectionMode(null));
  saveBtn.addEventListener('click', () => setSelectionMode('save'));
  selectBtn.addEventListener('click', () => setSelectionMode('select'));
  savedBtn.addEventListener('click', () => savedDrawer.hidden ? openSaved() : closeSaved());
  $('#closeSavedBtn').addEventListener('click', closeSaved);

  arrowBtn.addEventListener('click', () => {
    remember();
    const n = state.arrows.length;
    state.arrows.push({ id: uid(), x: .34 + (n % 4) * .11, y: .3 + (n % 3) * .13, turn: [-24, 12, -8, 27][n % 4] });
    render(); save(); hint.textContent = 'Arrow added—drag it where the connection clicks.';
  });

  tidyBtn.addEventListener('click', () => {
    if (!state.notes.length) return;
    remember();
    const cols = board.clientWidth < 520 ? 2 : board.clientWidth < 850 ? 3 : 4;
    state.notes.forEach((note, index) => {
      note.x = .035 + (index % cols) * (.91 / cols);
      note.y = .05 + Math.floor(index / cols) * .34;
      note.tilt = [-2, 1, -1, 2][index % 4];
    });
    render(); save(); hint.textContent = 'A little order. Still enough chaos.';
  });

  undoBtn.addEventListener('click', () => {
    if (!history.length) return;
    state = normalize(JSON.parse(history.pop()));
    selected.clear(); activeNoteId = null; noteDoodleId = null;
    render(); restoreDoodle(); save();
  });

  clearBtn.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.innerHTML = '<span class="tool-icon" aria-hidden="true">!</span>Sure?';
      hint.textContent = 'Click “Sure?” once more to clear the active board. Saved notes stay safe.';
      setTimeout(() => {
        clearArmed = false;
        clearBtn.innerHTML = '<span class="tool-icon" aria-hidden="true">×</span>Clear';
      }, 3000);
      return;
    }
    remember();
    state.notes = []; state.arrows = []; state.groups = []; state.doodle = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    clearArmed = false; clearBtn.innerHTML = '<span class="tool-icon" aria-hidden="true">×</span>Clear';
    render(); save();
  });

  doodleBtn.addEventListener('click', () => setCanvasMode(canvasMode === 'draw' ? null : 'draw'));
  eraserBtn.addEventListener('click', () => setCanvasMode(canvasMode === 'erase' ? null : 'erase'));

  function setCanvasMode(mode) {
    canvasMode = mode;
    if (mode) { selectionMode = null; selected.clear(); activeNoteId = null; noteDoodleId = null; }
    canvas.classList.toggle('is-active', Boolean(mode));
    canvas.classList.toggle('is-erasing', mode === 'erase');
    doodleBtn.setAttribute('aria-pressed', String(mode === 'draw'));
    eraserBtn.setAttribute('aria-pressed', String(mode === 'erase'));
    saveBtn.setAttribute('aria-pressed', 'false'); selectBtn.setAttribute('aria-pressed', 'false');
    hint.textContent = mode === 'draw' ? 'Doodle mode: draw anywhere. Tap Doodle again when done.' : mode === 'erase' ? 'Eraser mode: scrub over doodles to remove them.' : 'Tap a note for options. Drag to move it.';
    updateSelectionDock();
  }

  function localCanvasPoint(target, event) {
    const rect = target.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * target.width / rect.width, y: (event.clientY - rect.top) * target.height / rect.height };
  }

  canvas.addEventListener('pointerdown', event => {
    if (!canvasMode) return;
    remember(); drawing = true; canvas.setPointerCapture(event.pointerId);
    const point = localCanvasPoint(canvas, event);
    ctx.beginPath(); ctx.moveTo(point.x, point.y);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    const point = localCanvasPoint(canvas, event);
    ctx.lineTo(point.x, point.y);
    ctx.globalCompositeOperation = canvasMode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = (canvasMode === 'erase' ? 24 : 3) * (window.devicePixelRatio || 1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  });
  const finishDrawing = () => {
    if (!drawing) return;
    drawing = false; ctx.globalCompositeOperation = 'source-over';
    state.doodle = canvas.toDataURL('image/png'); save();
  };
  canvas.addEventListener('pointerup', finishDrawing);
  canvas.addEventListener('pointercancel', finishDrawing);

  function restoreDoodle() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.doodle) return;
    const image = new Image();
    image.onload = () => ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = state.doodle;
  }

  function sizeCanvas() {
    const previous = state.doodle || (canvas.width ? canvas.toDataURL('image/png') : '');
    const rect = board.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * (window.devicePixelRatio || 1)));
    canvas.height = Math.max(1, Math.round(rect.height * (window.devicePixelRatio || 1)));
    state.doodle = previous; restoreDoodle(); requestAnimationFrame(renderGroups);
  }

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { sizeCanvas(); render(); }, 120);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!savedDrawer.hidden) closeSaved();
    else if (selectionMode) setSelectionMode(null);
    else if (canvasMode) setCanvasMode(null);
    else if (activeNoteId) { activeNoteId = null; noteDoodleId = null; render(); }
  });

  loadLocal(); render(); requestAnimationFrame(sizeCanvas); hydrateRemote();
})();
