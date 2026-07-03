/* ========================================================================
 * Measurement time booking calendar
 *
 * Bookings and the list of available setups are stored as JSON in this
 * GitHub repository (data/) and read/written through the GitHub Contents
 * API. Everyone in the group needs the shared token once (Settings ⚙);
 * it is kept in localStorage of their own browser.
 * ====================================================================== */

/* ------------------------- configuration ------------------------------ */
const CONFIG = {
  owner: 'fewagner',
  repo: 'setup_schedule',
  branch: 'main',           // branch that stores the data
  dataPath: 'data/bookings.json',
  setupsPath: 'data/setups.json',
  // Fallback only — the live list is data/setups.json, editable in ⚙ Settings:
  defaultSetups: ['Setup A', 'Setup B', 'Setup C'],
  // How often the calendar re-loads bookings in the background (minutes):
  autoRefreshMinutes: 5,
};

const SETUP_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2'];

/* --------------------------- small helpers ---------------------------- */
const $ = (sel) => document.querySelector(sel);

function getToken() { return localStorage.getItem('gh_token') || ''; }

function apiUrl(path) {
  return `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`;
}

function apiHeaders() {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

// UTF-8 safe base64 helpers (atob/btoa alone choke on non-ASCII)
function b64encode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64decode(b64) {
  const bytes = Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function setupColor(setup) {
  let i = currentSetups.indexOf(setup);
  if (i < 0) {
    // setup no longer in the list (deleted) — hash the name to a stable color
    i = [...setup].reduce((a, c) => a + c.charCodeAt(0), 0);
  }
  return SETUP_COLORS[i % SETUP_COLORS.length];
}

// Date -> value for <input type="datetime-local"> in local time
function toLocalInput(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function fmt(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function showBanner(msg, kind = 'info') {
  const el = $('#status-banner');
  el.textContent = msg;
  el.className = `banner ${kind}`;
}
function hideBanner() { $('#status-banner').className = 'banner hidden'; }

/* ----------------------- GitHub data storage -------------------------- */

// Reads a JSON file from the repo. Returns { data, sha, missing }.
async function fetchJson(path) {
  const res = await fetch(`${apiUrl(path)}?ref=${CONFIG.branch}`, { headers: apiHeaders() });
  if (res.status === 404) return { data: null, sha: null, missing: true };
  if (!res.ok) {
    throw new Error(`GitHub API: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  let data = null;
  try { data = JSON.parse(b64decode(body.content)); } catch { data = null; }
  return { data, sha: body.sha, missing: false };
}

// Re-fetches `path`, applies `mutate(data)`, commits. Retries on write
// conflicts so two people saving at the same moment both get through.
async function commitJson(path, mutate, message) {
  if (!getToken()) {
    throw new Error('No GitHub token set. Open ⚙ Settings to add one.');
  }
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, sha } = await fetchJson(path);
    const updated = mutate(data);
    const body = {
      message,
      branch: CONFIG.branch,
      content: b64encode(JSON.stringify(updated, null, 2) + '\n'),
    };
    if (sha) body.sha = sha;
    const res = await fetch(apiUrl(path), {
      method: 'PUT',
      headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return updated;
    if (res.status === 409) { lastErr = new Error('Write conflict'); continue; }
    if (res.status === 401 || res.status === 403) {
      throw new Error('GitHub rejected the token (expired or missing write permission). Check ⚙ Settings.');
    }
    if (res.status === 404) {
      throw new Error('Repository not reachable with this token — does it have access to ' +
        `${CONFIG.owner}/${CONFIG.repo}?`);
    }
    throw new Error(`GitHub API: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  throw lastErr || new Error('Could not save.');
}

async function fetchBookings() {
  const { data, missing } = await fetchJson(CONFIG.dataPath);
  return { bookings: Array.isArray(data) ? data : [], missing };
}

function commitBookings(mutateList, message) {
  return commitJson(
    CONFIG.dataPath,
    (data) => mutateList(Array.isArray(data) ? data.slice() : []),
    message,
  );
}

async function fetchSetups() {
  const { data, missing } = await fetchJson(CONFIG.setupsPath);
  const list = Array.isArray(data)
    ? data.filter((s) => typeof s === 'string' && s.trim())
    : null;
  return { setups: list && list.length ? list : CONFIG.defaultSetups.slice(), missing };
}

function commitSetups(mutateList, message) {
  return commitJson(
    CONFIG.setupsPath,
    (data) => mutateList(Array.isArray(data) ? data.slice() : CONFIG.defaultSetups.slice()),
    message,
  );
}

/* ------------------------------ calendar ------------------------------ */
let calendar;
let currentBookings = [];
let currentSetups = CONFIG.defaultSetups.slice();

function bookingsToEvents(bookings) {
  const now = Date.now();
  return bookings.map((b) => ({
    id: b.id,
    title: `${b.name} · ${b.setup}`,
    start: b.start,
    end: b.end,
    backgroundColor: setupColor(b.setup),
    borderColor: setupColor(b.setup),
    classNames: new Date(b.end).getTime() < now ? ['past-event'] : [],
    extendedProps: b,
  }));
}

function renderEvents() {
  calendar.removeAllEvents();
  bookingsToEvents(currentBookings).forEach((e) => calendar.addEvent(e));
}

async function reloadData({ quiet = false } = {}) {
  try {
    const [b, s] = await Promise.all([fetchBookings(), fetchSetups()]);
    currentBookings = b.bookings;
    currentSetups = s.setups;
    refreshSetupSelect();
    renderEvents();
    if (b.missing && !getToken()) {
      showBanner('Could not load bookings — if this repository is private, add a token in ⚙ Settings.', 'warn');
    } else if (!quiet) {
      hideBanner();
    }
  } catch (err) {
    showBanner(`Loading bookings failed: ${err.message}`, 'error');
  }
}

function initCalendar() {
  const isPhone = window.matchMedia('(max-width: 700px)').matches;
  calendar = new FullCalendar.Calendar($('#calendar'), {
    initialView: isPhone ? 'timeGridThreeDay' : 'timeGridWeek',
    views: {
      timeGridThreeDay: {
        type: 'timeGrid',
        duration: { days: 3 },
        buttonText: '3 day',
      },
    },
    headerToolbar: {
      left: 'prev,next today',
      center: isPhone ? '' : 'title',
      right: isPhone
        ? 'timeGridThreeDay,timeGridDay,dayGridMonth'
        : 'timeGridWeek,timeGridDay,dayGridMonth',
    },
    height: '100%',
    nowIndicator: true,           // red line at the current time
    scrollTime: '07:00:00',
    firstDay: 1,                  // weeks start on Monday
    allDaySlot: false,
    longPressDelay: 250,          // touch: press briefly, then drag to select
    selectable: true,
    selectMirror: true,
    select: (info) => {
      openBookingForm(info.start, info.end);
      calendar.unselect();
    },
    eventClick: (info) => openDetails(info.event.extendedProps),
    dayHeaderFormat: { weekday: 'short', day: 'numeric', month: 'numeric' },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
  });
  calendar.render();
}

/* --------------------------- booking form ----------------------------- */
function refreshSetupSelect() {
  const sel = $('#f-setup');
  const previous = sel.value;
  sel.innerHTML = '';
  currentSetups.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  });
  if (currentSetups.includes(previous)) sel.value = previous;
}

function openBookingForm(start, end) {
  $('#f-name').value = localStorage.getItem('booker_name') || '';
  $('#f-start').value = toLocalInput(start);
  $('#f-end').value = toLocalInput(end);
  $('#f-note').value = '';
  $('#form-error').classList.add('hidden');
  $('#booking-dialog').showModal();
}

async function submitBooking(ev) {
  ev.preventDefault();
  const name = $('#f-name').value.trim();
  const setup = $('#f-setup').value;
  const start = new Date($('#f-start').value);
  const end = new Date($('#f-end').value);
  const errEl = $('#form-error');

  if (!setup) {
    errEl.textContent = 'No setup selected — add one in ⚙ Settings first.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!(end > start)) {
    errEl.textContent = 'End must be after start.';
    errEl.classList.remove('hidden');
    return;
  }
  localStorage.setItem('booker_name', name);

  const booking = {
    id: crypto.randomUUID(),
    name,
    setup,
    start: start.toISOString(),
    end: end.toISOString(),
    note: $('#f-note').value.trim(),
    createdAt: new Date().toISOString(),   // added automatically
  };

  const btn = $('#f-submit');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    currentBookings = await commitBookings(
      (list) => { list.push(booking); return list; },
      `Booking: ${name} — ${setup} (${fmt(booking.start)} → ${fmt(booking.end)})`,
    );
    renderEvents();
    $('#booking-dialog').close();
    hideBanner();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save booking';
  }
}

/* -------------------------- booking details --------------------------- */
let detailsBooking = null;

function openDetails(b) {
  detailsBooking = b;
  $('#d-title').textContent = b.name;
  $('#d-setup').textContent = b.setup;
  $('#d-start').textContent = fmt(b.start);
  $('#d-end').textContent = fmt(b.end);
  $('#d-note').textContent = b.note || '—';
  $('#d-created').textContent = b.createdAt ? fmt(b.createdAt) : '—';
  $('#details-error').classList.add('hidden');
  $('#details-dialog').showModal();
}

async function deleteBooking() {
  if (!detailsBooking) return;
  const b = detailsBooking;
  if (!confirm(`Delete the booking of ${b.name} on ${fmt(b.start)}?`)) return;
  const btn = $('#d-delete');
  btn.disabled = true;
  try {
    currentBookings = await commitBookings(
      (list) => list.filter((x) => x.id !== b.id),
      `Cancel booking: ${b.name} — ${b.setup} (${fmt(b.start)})`,
    );
    renderEvents();
    $('#details-dialog').close();
  } catch (err) {
    const errEl = $('#details-error');
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

/* -------------------------- setup management -------------------------- */
function showSetupError(msg) {
  const el = $('#setup-error');
  if (msg) { el.textContent = msg; el.classList.remove('hidden'); }
  else el.classList.add('hidden');
}

function renderSetupList() {
  const ul = $('#setup-list');
  ul.innerHTML = '';
  currentSetups.forEach((s) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'setup-dot';
    dot.style.background = setupColor(s);
    const label = document.createElement('span');
    label.className = 'setup-name';
    label.textContent = s;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'setup-delete';
    del.title = `Delete ${s}`;
    del.textContent = '✕';
    del.addEventListener('click', () => deleteSetup(s));
    li.append(dot, label, del);
    ul.appendChild(li);
  });
  if (!currentSetups.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No setups yet — add one below.';
    ul.appendChild(li);
  }
}

async function addSetup() {
  const input = $('#f-new-setup');
  const name = input.value.trim();
  if (!name) return;
  if (currentSetups.some((s) => s.toLowerCase() === name.toLowerCase())) {
    showSetupError(`"${name}" is already in the list.`);
    return;
  }
  const btn = $('#s-add');
  btn.disabled = true;
  try {
    currentSetups = await commitSetups(
      (list) => {
        if (!list.some((s) => s.toLowerCase() === name.toLowerCase())) list.push(name);
        return list;
      },
      `Add setup: ${name}`,
    );
    input.value = '';
    showSetupError(null);
    renderSetupList();
    refreshSetupSelect();
    renderEvents();   // colors depend on the list order
  } catch (err) {
    showSetupError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function deleteSetup(name) {
  if (!confirm(`Remove "${name}" from the setup list?\n\nExisting bookings for it are kept — it just disappears from the dropdown for new bookings.`)) return;
  try {
    currentSetups = await commitSetups(
      (list) => list.filter((s) => s !== name),
      `Remove setup: ${name}`,
    );
    showSetupError(null);
    renderSetupList();
    refreshSetupSelect();
    renderEvents();
  } catch (err) {
    showSetupError(err.message);
  }
}

/* ------------------------------ settings ------------------------------ */
function openSettings() {
  $('#f-token').value = getToken();
  showSetupError(null);
  renderSetupList();
  $('#settings-dialog').showModal();
}

/* -------------------------------- init -------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  // One-tap setup via a privately shared link: …/#token=github_pat_xxx
  // The token is moved into localStorage and scrubbed from the URL so it
  // doesn't linger in the address bar or get re-shared by accident.
  const hashToken = location.hash.match(/token=([^&]+)/);
  if (hashToken) {
    localStorage.setItem('gh_token', decodeURIComponent(hashToken[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }

  refreshSetupSelect();
  initCalendar();
  reloadData();

  // wire up UI
  $('#booking-form').addEventListener('submit', submitBooking);
  $('#new-booking-btn').addEventListener('click', () => {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 2 * 3600 * 1000);
    openBookingForm(start, end);
  });
  $('#refresh-btn').addEventListener('click', () => reloadData());
  $('#rules-btn').addEventListener('click', () => $('#rules-dialog').showModal());
  $('#settings-btn').addEventListener('click', openSettings);
  $('#d-delete').addEventListener('click', deleteBooking);
  $('#s-add').addEventListener('click', addSetup);
  $('#f-new-setup').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSetup(); }
  });
  $('#t-save').addEventListener('click', () => {
    const t = $('#f-token').value.trim();
    if (t) localStorage.setItem('gh_token', t);
    $('#settings-dialog').close();
    reloadData();
  });
  $('#t-clear').addEventListener('click', () => {
    localStorage.removeItem('gh_token');
    $('#f-token').value = '';
  });
  $('#t-share').addEventListener('click', async () => {
    const t = $('#f-token').value.trim() || getToken();
    if (!t) { alert('Save a token first.'); return; }
    const link = `${location.origin}${location.pathname}#token=${encodeURIComponent(t)}`;
    try {
      await navigator.clipboard.writeText(link);
      $('#t-share').textContent = '✓ Copied';
      setTimeout(() => { $('#t-share').textContent = 'Copy share link'; }, 2000);
    } catch {
      prompt('Copy this link and share it privately:', link);
    }
  });
  document.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => btn.closest('dialog').close()));

  // keep the view fresh: on tab focus and on a timer
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reloadData({ quiet: true });
  });
  setInterval(() => reloadData({ quiet: true }),
    CONFIG.autoRefreshMinutes * 60 * 1000);

  if (!getToken()) {
    showBanner('Read-only: add your GitHub token in ⚙ Settings to make bookings.', 'info');
  }

  // show the usage rules once on a person's first visit
  if (!localStorage.getItem('rules_seen')) {
    localStorage.setItem('rules_seen', '1');
    $('#rules-dialog').showModal();
  }
});
