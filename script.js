(() => {
  const board = document.querySelector('#board');
  const layer = document.querySelector('#itemsLayer');
  const canvas = document.querySelector('#doodleCanvas');
  const ctx = canvas.getContext('2d');
  const form = document.querySelector('#noteForm');
  const input = document.querySelector('#noteInput');
  const count = document.querySelector('#noteCount');
  const empty = document.querySelector('#emptyState');
  const doodleBtn = document.querySelector('#doodleBtn');
  const arrowBtn = document.querySelector('#arrowBtn');
  const tidyBtn = document.querySelector('#tidyBtn');
  const undoBtn = document.querySelector('#undoBtn');
  const clearBtn = document.querySelector('#clearBtn');
  const hint = document.querySelector('#modeHint');

  const STORAGE_KEY = 'notesguy-board-v1';
  const palette = { yellow: '#f8df66', pink: '#f4a6b9', blue: '#9ed8e8' };
  let selectedColor = 'yellow';
  let state = { notes: [], arrows: [], doodle: '' };
  let history = [];
  let drawing = false;
  let doodleMode = false;
  let clearArmed = false;
  let drag = null;
  let resizeTimer;

  const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const snapshot = () => JSON.stringify(state);

  function remember() {
    history.push(snapshot());
    if (history.length > 30) history.shift();
    undoBtn.disabled = false;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, snapshot()); } catch (_) {}
  }

  function starterState() {
    return {
      notes: [
        { id: uid(), text: 'What if ideas felt more like play?', color: 'yellow', x: .08, y: .12, tilt: -4 },
        { id: uid(), text: 'messy first.\nuseful later.', color: 'pink', x: .39, y: .43, tilt: 3 },
        { id: uid(), text: 'Build the weird version →', color: 'blue', x: .67, y: .16, tilt: -2 }
      ],
      arrows: [{ id: uid(), x: .58, y: .53, turn: -18 }],
      doodle: ''
    };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.notes) && Array.isArray(saved.arrows)) state = saved;
      else state = starterState();
    } catch (_) { state = starterState(); }
  }

  function updateUI() {
    count.textContent = state.notes.length;
    empty.hidden = state.notes.length + state.arrows.length > 0;
    undoBtn.disabled = history.length === 0;
  }

  function render() {
    layer.replaceChildren();
    state.arrows.forEach(renderArrow);
    state.notes.forEach(renderNote);
    updateUI();
  }

  function renderNote(note) {
    const el = document.createElement('article');
    el.className = 'sticky';
    el.dataset.id = note.id;
    el.dataset.kind = 'note';
    el.dataset.color = note.color;
    el.style.left = `${note.x * 100}%`;
    el.style.top = `${note.y * 100}%`;
    el.style.setProperty('--tilt', `${note.tilt}deg`);
    el.innerHTML = '<button class="delete-note" type="button" aria-label="Delete note">×</button><div class="sticky-text" tabindex="0"></div>';
    const text = el.querySelector('.sticky-text');
    text.textContent = note.text;
    text.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      text.contentEditable = 'true';
      text.focus();
      const range = document.createRange();
      range.selectNodeContents(text);
      range.collapse(false);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    text.addEventListener('blur', () => {
      if (text.contentEditable !== 'true') return;
      remember();
      note.text = text.textContent.trim() || 'untitled thought';
      text.textContent = note.text;
      text.contentEditable = 'false';
      save();
    });
    text.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') text.blur();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') text.blur();
    });
    el.querySelector('.delete-note').addEventListener('pointerdown', event => event.stopPropagation());
    el.querySelector('.delete-note').addEventListener('click', () => {
      remember();
      state.notes = state.notes.filter(item => item.id !== note.id);
      render();
      save();
    });
    el.addEventListener('pointerdown', startDrag);
    layer.appendChild(el);
  }

  function renderArrow(arrow) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'arrow-sticker';
    el.dataset.id = arrow.id;
    el.dataset.kind = 'arrow';
    el.setAttribute('aria-label', 'Movable arrow. Double-click to remove.');
    el.textContent = '↗';
    el.style.left = `${arrow.x * 100}%`;
    el.style.top = `${arrow.y * 100}%`;
    el.style.setProperty('--turn', `${arrow.turn}deg`);
    el.addEventListener('pointerdown', startDrag);
    el.addEventListener('dblclick', () => {
      remember();
      state.arrows = state.arrows.filter(item => item.id !== arrow.id);
      render();
      save();
    });
    layer.appendChild(el);
  }

  function startDrag(event) {
    if (doodleMode || event.target.closest('.delete-note') || event.target.contentEditable === 'true') return;
    const el = event.currentTarget;
    const item = state[el.dataset.kind === 'note' ? 'notes' : 'arrows'].find(entry => entry.id === el.dataset.id);
    if (!item) return;
    event.preventDefault();
    remember();
    const rect = el.getBoundingClientRect();
    drag = { el, item, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    el.classList.add('is-dragging');
    el.setPointerCapture(event.pointerId);
    el.addEventListener('pointermove', moveDrag);
    el.addEventListener('pointerup', endDrag, { once: true });
    el.addEventListener('pointercancel', endDrag, { once: true });
  }

  function moveDrag(event) {
    if (!drag) return;
    const bounds = board.getBoundingClientRect();
    const x = clamp(event.clientX - bounds.left - drag.dx, 0, bounds.width - drag.el.offsetWidth);
    const y = clamp(event.clientY - bounds.top - drag.dy, 0, bounds.height - drag.el.offsetHeight);
    drag.item.x = x / bounds.width;
    drag.item.y = y / bounds.height;
    drag.el.style.left = `${drag.item.x * 100}%`;
    drag.el.style.top = `${drag.item.y * 100}%`;
  }

  function endDrag(event) {
    if (!drag) return;
    drag.el.classList.remove('is-dragging');
    drag.el.removeEventListener('pointermove', moveDrag);
    try { drag.el.releasePointerCapture(event.pointerId); } catch (_) {}
    drag = null;
    save();
  }

  function addNote(text) {
    remember();
    const offset = state.notes.length % 6;
    state.notes.push({
      id: uid(), text, color: selectedColor,
      x: clamp(.12 + offset * .105, .02, .72),
      y: clamp(.11 + (offset % 3) * .16, .03, .67),
      tilt: [-4, 2, -1, 4, -3, 1][offset]
    });
    render();
    save();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addNote(text);
    input.value = '';
    input.focus();
  });

  document.querySelectorAll('.swatch').forEach(button => {
    button.addEventListener('click', () => {
      selectedColor = button.dataset.color;
      document.querySelectorAll('.swatch').forEach(swatch => swatch.classList.toggle('is-selected', swatch === button));
      input.style.background = palette[selectedColor];
      input.focus();
    });
  });

  arrowBtn.addEventListener('click', () => {
    remember();
    const n = state.arrows.length;
    state.arrows.push({ id: uid(), x: .34 + (n % 4) * .11, y: .3 + (n % 3) * .13, turn: [-24, 12, -8, 27][n % 4] });
    render();
    save();
    hint.textContent = 'Arrow added—drag it where the connection clicks.';
  });

  tidyBtn.addEventListener('click', () => {
    if (!state.notes.length) return;
    remember();
    const width = board.clientWidth;
    const cols = width < 520 ? 2 : width < 850 ? 3 : 4;
    state.notes.forEach((note, index) => {
      note.x = .035 + (index % cols) * (.91 / cols);
      note.y = .05 + Math.floor(index / cols) * .34;
      note.tilt = [-2, 1, -1, 2][index % 4];
    });
    render();
    save();
    hint.textContent = 'A little order. Still enough chaos.';
  });

  undoBtn.addEventListener('click', () => {
    if (!history.length) return;
    state = JSON.parse(history.pop());
    render();
    restoreDoodle();
    save();
  });

  clearBtn.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.innerHTML = '<span class="tool-icon" aria-hidden="true">!</span>Sure?';
      hint.textContent = 'Click “Sure?” once more to clear the whole board.';
      setTimeout(() => {
        clearArmed = false;
        clearBtn.innerHTML = '<span class="tool-icon" aria-hidden="true">×</span>Clear';
      }, 3000);
      return;
    }
    remember();
    state = { notes: [], arrows: [], doodle: '' };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    clearArmed = false;
    clearBtn.innerHTML = '<span class="tool-icon" aria-hidden="true">×</span>Clear';
    render();
    save();
  });

  doodleBtn.addEventListener('click', () => {
    doodleMode = !doodleMode;
    canvas.classList.toggle('is-active', doodleMode);
    doodleBtn.setAttribute('aria-pressed', String(doodleMode));
    hint.textContent = doodleMode ? 'Doodle mode: draw anywhere. Tap Doodle again when done.' : 'Drag notes anywhere. Double-click one to edit.';
  });

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
  }

  canvas.addEventListener('pointerdown', event => {
    if (!doodleMode) return;
    remember();
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    const point = canvasPoint(event);
    ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 3 * devicePixelRatio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  });
  const finishDrawing = () => {
    if (!drawing) return;
    drawing = false;
    state.doodle = canvas.toDataURL('image/png');
    save();
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
    canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    state.doodle = previous;
    restoreDoodle();
  }

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sizeCanvas, 120);
  });

  load();
  render();
  requestAnimationFrame(sizeCanvas);
})();
