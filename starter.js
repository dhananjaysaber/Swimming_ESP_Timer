// ==== CONFIG ====
// GAS Web App URL
const API =
  'https://script.google.com/macros/s/AKfycbxeZVjT5VEh4L96vDxDqiR1DHMMRE7td4VlR4Kqnr-NFRUAuI0HeDqVuV6K5SWT0gFaWg/exec';

// ESP32 WebSocket (same IP as printed in Serial Monitor)
const ESP32_WS_URL = 'ws://172.18.0.98:81';

// Max lanes
const MAX_LANES = 8;

// State
let overview = [];
let currentEventIndex = 0;
let currentHeatIndex = 0;
let laneStatusInterval = null;
let espSocket = null;

/* ================================
   🔊 START TONE
================================ */
function playStartTone() {
  const audioEl = document.getElementById('startTone');
  if (!audioEl) {
    console.warn('startTone <audio> not found in DOM');
    return;
  }

  // Safari / Chrome may need a catch to ignore promise rejection
  const p = audioEl.play();
  if (p && typeof p.catch === 'function') {
    p.catch((err) => {
      console.warn('Audio play blocked by browser, user interaction needed.', err);
    });
  }
}

/* ================================
   ESP32 WEBSOCKET (starter side)
   - Listens for cmd=start → plays tone
================================ */
function connectToEsp32() {
  console.log('Connecting to ESP32 from starter:', ESP32_WS_URL);

  try {
    espSocket = new WebSocket(ESP32_WS_URL);

    espSocket.onopen = () => {
      console.log('✅ Starter connected to ESP32 WebSocket');
    };

    espSocket.onclose = () => {
      console.log('⚠️ Starter ESP32 WebSocket closed, retrying in 2s…');
      setTimeout(connectToEsp32, 2000);
    };

    espSocket.onerror = (err) => {
      console.error('Starter ESP32 WebSocket error:', err);
    };

    espSocket.onmessage = (event) => {
      const msg = String(event.data || '').trim();
      console.log('📡 Starter ESP32 message:', msg);

      // Expecting "source=esp32&cmd=start" style messages
      const params = new URLSearchParams(msg);
      const cmd = params.get('cmd');

      if (cmd === 'start') {
        // 🔊 Play tone when jumper is pressed
        playStartTone();
      }
      // (You could later respond to cmd=stop/reset if you want visuals here.)
    };
  } catch (e) {
    console.error('Failed to create starter WebSocket:', e);
    setTimeout(connectToEsp32, 2000);
  }
}

/* ================================
   OVERVIEW: EVENTS & HEATS
================================ */
async function loadOverview() {
  try {
    const res = await fetch(`${API}?action=getOverview`);
    const data = await res.json();

    if (!data.ok) {
      alert('Unable to load Events & Heats overview.');
      console.error('Overview error:', data);
      return;
    }

    overview = data.events || [];
    if (!overview.length) {
      alert('No events found in HeatSheet.');
      return;
    }

    currentEventIndex = 0;
    currentHeatIndex = 0;
    renderCurrent();
  } catch (err) {
    console.error('Overview fetch error:', err);
    alert('Error contacting server for overview.');
  }
}

/* ================================
   Render current Event & Heat
================================ */
function renderCurrent() {
  if (!overview.length) return;

  const evObj = overview[currentEventIndex];
  const evNum = evObj.event;
  const heats = evObj.heats;

  if (currentHeatIndex < 0) currentHeatIndex = 0;
  if (currentHeatIndex >= heats.length) currentHeatIndex = heats.length - 1;

  const htNum = heats[currentHeatIndex];

  document.getElementById('curEvent').textContent = evNum;
  document.getElementById('curHeat').textContent = htNum;
  document.getElementById(
    'heatListText'
  ).textContent = `Heats for Event ${evNum}: ${heats.join(', ')}`;

  // Lane links for this Event + Heat
  renderLaneLinks(evNum, htNum);

  // Sync pointer so lane pages follow this race
  syncCurrentPointer(evNum, htNum);

  // Lane readiness panel
  initLaneStatusPanel(evNum, htNum);
  startLaneStatusPolling(evNum, htNum);
}

/* ================================
   Sync current pointer to GAS
================================ */
async function syncCurrentPointer(eventNo, heatNo) {
  try {
    await fetch(
      `${API}?action=setCurrentPointer&event=${encodeURIComponent(
        eventNo
      )}&heat=${encodeURIComponent(heatNo)}`
    );
  } catch (err) {
    console.error('setCurrentPointer error:', err);
  }
}

/* ================================
   Lane links (for QR / copy)
================================ */
function renderLaneLinks(eventNo, heatNo) {
  const container = document.getElementById('laneLinks');
  container.innerHTML = '';

  const baseOrigin = window.location.origin;
  const lanePage = '/'; // index.html at root

  for (let lane = 1; lane <= MAX_LANES; lane++) {
    const params = new URLSearchParams({
      lane: lane.toString(),
      event: String(eventNo),
      heat: String(heatNo),
    });

    const url = `${baseOrigin}${lanePage}?${params.toString()}`;

    const row = document.createElement('div');
    row.className = 'lane-row';

    const label = document.createElement('span');
    label.textContent = `Lane ${lane}`;

    const urlSpan = document.createElement('div');
    urlSpan.className = 'lane-url';
    urlSpan.textContent = url;

    const btn = document.createElement('button');
    btn.textContent = 'Copy';
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'Copied!';
        setTimeout(() => (btn.textContent = 'Copy'), 1500);
      } catch (err) {
        console.error('Clipboard error:', err);
        alert('Unable to copy. Please copy manually.');
      }
    };

    row.appendChild(label);
    row.appendChild(urlSpan);
    row.appendChild(btn);
    container.appendChild(row);
  }
}

/* ================================
   Lane readiness panel
   Needs backend: action=getLaneStatuses
================================ */
function initLaneStatusPanel(eventNo, heatNo) {
  const panel = document.getElementById('laneStatusPanel');
  if (!panel) return;
  panel.innerHTML = '';

  const evSpan = document.getElementById('statusEvent');
  const htSpan = document.getElementById('statusHeat');
  if (evSpan) evSpan.textContent = eventNo;
  if (htSpan) htSpan.textContent = heatNo;

  for (let lane = 1; lane <= MAX_LANES; lane++) {
    const row = document.createElement('div');
    row.className = 'lane-status-row';
    row.dataset.lane = lane;

    const label = document.createElement('div');
    label.className = 'lane-status-label';
    label.textContent = `Lane ${lane}`;

    const pill = document.createElement('div');
    pill.className = 'lane-status-pill waiting';
    pill.textContent = 'Waiting';

    row.appendChild(label);
    row.appendChild(pill);
    panel.appendChild(row);
  }
}

async function fetchLaneStatuses(eventNo, heatNo) {
  try {
    const res = await fetch(
      `${API}?action=getLaneStatuses&event=${encodeURIComponent(
        eventNo
      )}&heat=${encodeURIComponent(heatNo)}`
    );
    const data = await res.json();
    if (!data.ok || !data.statuses) return;

    const statuses = data.statuses; // { "1":"ready", "2":"not-ready", ... }

    Object.keys(statuses).forEach((laneStr) => {
      const laneNum = Number(laneStr);
      if (!laneNum) return;

      const row = document.querySelector(
        `.lane-status-row[data-lane="${laneNum}"]`
      );
      if (!row) return;

      const pill = row.querySelector('.lane-status-pill');
      if (!pill) return;

      const status = String(statuses[laneStr]).toLowerCase();

      pill.classList.remove('ready', 'not-ready', 'waiting');

      if (status === 'ready') {
        pill.classList.add('ready');
        pill.textContent = 'Ready';
      } else if (status === 'not-ready') {
        pill.classList.add('not-ready');
        pill.textContent = 'Not Ready';
      } else {
        pill.classList.add('waiting');
        pill.textContent = 'Waiting';
      }
    });
  } catch (err) {
    console.error('fetchLaneStatuses error:', err);
  }
}

function startLaneStatusPolling(eventNo, heatNo) {
  if (laneStatusInterval) clearInterval(laneStatusInterval);

  fetchLaneStatuses(eventNo, heatNo);
  laneStatusInterval = setInterval(
    () => fetchLaneStatuses(eventNo, heatNo),
    2000
  );
}

/* ================================
   Navigation handlers
================================ */
function attachNavHandlers() {
  const prevEventBtn = document.getElementById('prevEventBtn');
  const nextEventBtn = document.getElementById('nextEventBtn');
  const prevHeatBtn = document.getElementById('prevHeatBtn');
  const nextHeatBtn = document.getElementById('nextHeatBtn');
  const setRaceBtn = document.getElementById('setRaceBtn');
  const startRaceBtn = document.getElementById('startRaceBtn');
  const testToneBtn = document.getElementById('testToneBtn');

  if (prevEventBtn) {
    prevEventBtn.onclick = () => {
      if (!overview.length) return;
      currentEventIndex = Math.max(0, currentEventIndex - 1);
      currentHeatIndex = 0;
      renderCurrent();
    };
  }

  if (nextEventBtn) {
    nextEventBtn.onclick = () => {
      if (!overview.length) return;
      currentEventIndex = Math.min(overview.length - 1, currentEventIndex + 1);
      currentHeatIndex = 0;
      renderCurrent();
    };
  }

  if (prevHeatBtn) {
    prevHeatBtn.onclick = () => {
      if (!overview.length) return;
      currentHeatIndex = Math.max(0, currentHeatIndex - 1);
      renderCurrent();
    };
  }

  if (nextHeatBtn) {
    nextHeatBtn.onclick = () => {
      if (!overview.length) return;
      const evObj = overview[currentEventIndex];
      if (!evObj || !evObj.heats) return;
      currentHeatIndex = Math.min(evObj.heats.length - 1, currentHeatIndex + 1);
      renderCurrent();
    };
  }

  // SET RACE TO LANES → just re-sync pointer + reset readiness panel
  if (setRaceBtn) {
    setRaceBtn.onclick = () => {
      if (!overview.length) return;
      const evObj = overview[currentEventIndex];
      if (!evObj) return;
      const evNum = evObj.event;
      const htNum = evObj.heats[currentHeatIndex];

      syncCurrentPointer(evNum, htNum);

      const statusEl = document.getElementById('startStatus');
      if (statusEl) {
        statusEl.textContent = `Race assigned to lanes: Event ${evNum} Heat ${htNum}.`;
        statusEl.style.color = '#38bdf8';
      }

      initLaneStatusPanel(evNum, htNum);
      startLaneStatusPolling(evNum, htNum);
    };
  }

  // START RACE button: keep ONLY for logging (optional) + tone
  if (startRaceBtn) {
    startRaceBtn.onclick = async () => {
      if (!overview.length) return;
      const evObj = overview[currentEventIndex];
      if (!evObj) return;

      const evNum = evObj.event;
      const htNum = evObj.heats[currentHeatIndex];

      // 🔊 Play tone if starter presses this button manually
      playStartTone();

      // Try to log START in GAS (optional, if RaceSignals is configured)
      try {
        const res = await fetch(
          `${API}?action=setStart&event=${encodeURIComponent(
            evNum
          )}&heat=${encodeURIComponent(htNum)}`
        );
        const data = await res.json();

        const statusEl = document.getElementById('startStatus');
        if (data.ok) {
          if (statusEl) {
            statusEl.textContent = `Event ${evNum} Heat ${htNum} has been logged as STARTED.`;
            statusEl.style.color = '#22c55e';
          }
        } else {
          console.error('setStart error:', data);
          if (statusEl) {
            statusEl.textContent = `Could not log START for Event ${evNum} Heat ${htNum}.`;
            statusEl.style.color = '#f97373';
          }
        }
      } catch (err) {
        console.error('triggerStart error:', err);
        const statusEl = document.getElementById('startStatus');
        if (statusEl) {
          statusEl.textContent = 'Error contacting server to log START.';
          statusEl.style.color = '#f97373';
        }
      }
    };
  }

  // TEST SOUND
  if (testToneBtn) {
    testToneBtn.onclick = () => {
      playStartTone();
    };
  }
}

/* ================================
   INIT
================================ */
document.addEventListener('DOMContentLoaded', () => {
  attachNavHandlers();
  loadOverview();
  connectToEsp32(); // listen to jumper → tone
});
