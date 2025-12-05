/* ===== CONFIG ===== */
const API =
  'https://script.google.com/macros/s/AKfycbxeZVjT5VEh4L96vDxDqiR1DHMMRE7td4VlR4Kqnr-NFRUAuI0HeDqVuV6K5SWT0gFaWg/exec';

// 🔧 ESP32 WebSocket URL (update IP if ESP32 gets a new one)
const ESP32_WS_URL = 'ws://172.18.0.98:81';

let lane,
  eventNo = null,
  heatNo = null,
  uniqueId = null;

// Timer state (purely local, no GAS startTs)
let startTs = null; // ms since epoch when lane timer started
let timerInterval = null;

/* ================================
   Helpers
================================ */
function setRaceStatus(text, color) {
  const el = document.getElementById('raceStatus');
  if (!el) return;
  el.textContent = text;
  if (color) el.style.color = color;
}

function formatElapsedFromStart() {
  if (!startTs) return '00:00.00';
  const now = Date.now();
  const elapsedMs = now - startTs;
  if (elapsedMs < 0) return '00:00.00';

  const totalSeconds = elapsedMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2);

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    5,
    '0'
  )}`;
}

/* ================================
   Parse URL parameters
   First time: ?lane=1&event=1&heat=1
   Later races: event/heat will follow starter pointer.
================================ */
function getParams() {
  const url = new URL(window.location.href);
  lane = url.searchParams.get('lane') || '?';

  // Optional initial event/heat (for first race)
  const ev = url.searchParams.get('event');
  const ht = url.searchParams.get('heat');
  if (ev) eventNo = String(ev);
  if (ht) heatNo = String(ht);

  document.getElementById('laneNumber').textContent = `LANE ${lane}`;
}

/* ================================
   Fetch lane details from GAS
   Uses: eventNo, heatNo, lane
================================ */
async function loadLaneData() {
  if (!eventNo || !heatNo || !lane) return;

  try {
    const res = await fetch(
      `${API}?action=getLane&event=${eventNo}&heat=${heatNo}&lane=${lane}`
    );
    const data = await res.json();

    if (!data.ok) {
      console.error('GAS response error:', data);
      document.getElementById('swimmerName').textContent = 'No swimmer';
      document.getElementById('swimmerSchool').textContent = '';
      document.getElementById(
        'laneStatus'
      ).textContent = `Event ${eventNo}, Heat ${heatNo} • Lane ${lane} (NO ENTRY)`;
      return;
    }

    uniqueId = data.uniqueId;

    document.getElementById('swimmerName').textContent = data.swimmer;
    document.getElementById('swimmerSchool').textContent = data.school;
    document.getElementById(
      'laneStatus'
    ).textContent = `Loaded Event ${eventNo}, Heat ${heatNo} • Lane ${lane}`;

    // After successfully loading swimmer, mark this lane as READY
    sendLaneStatus('ready');
  } catch (err) {
    console.error('Error loading lane data:', err);
    alert('Error contacting timing server. Check network.');
  }
}

/* ================================
   TIMER FUNCTIONS (local only)
================================ */
function updateTimerDisplay() {
  const t = formatElapsedFromStart();
  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = t;
}

function startTimerLocal() {
  if (timerInterval) return; // already running
  startTs = Date.now();
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 10);
  setRaceStatus('Race Status: Running', '#22c55e');
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  updateTimerDisplay();
  setRaceStatus('Race Status: Finished', '#f97316');
}

function resetLaneTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  startTs = null;
  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = '00:00.00';
  setRaceStatus('Race Status: Not ready', '#facc15');
  // When resetting for a new race, mark NOT READY until swimmer is loaded
  sendLaneStatus('not-ready');
}

/* ================================
   LANE STATUS → GAS
   (Used by starter to see readiness)
   Backend needs: action=updateLaneStatus
================================ */
async function sendLaneStatus(status) {
  if (!lane || !eventNo || !heatNo) return;
  try {
    await fetch(
      `${API}?action=updateLaneStatus&lane=${encodeURIComponent(
        lane
      )}&event=${encodeURIComponent(eventNo)}&heat=${encodeURIComponent(
        heatNo
      )}&status=${encodeURIComponent(status)}`
    );
  } catch (err) {
    console.error('sendLaneStatus error:', err);
  }
}

/* ================================
   FOLLOW STARTER POINTER
   Polls GAS for current Event/Heat
   Backend needs: action=getCurrentPointer
   Returns: { ok, event, heat }
================================ */
let pointerPollInterval = null;

async function pollCurrentPointerOnce() {
  try {
    const res = await fetch(`${API}?action=getCurrentPointer`);
    const data = await res.json();

    if (!data.ok || !data.event || !data.heat) return;

    const ev = String(data.event);
    const ht = String(data.heat);

    // First time or when starter changes race
    if (ev !== String(eventNo) || ht !== String(heatNo)) {
      eventNo = ev;
      heatNo = ht;

      // New race selected by starter
      resetLaneTimer(); // clear previous race time
      await loadLaneData(); // fetch swimmer for new Event/Heat/Lane
    }
  } catch (err) {
    console.error('pollCurrentPointer error:', err);
  }
}

function startPointerPolling() {
  // Run immediately once
  pollCurrentPointerOnce();
  // Then every 2 seconds
  pointerPollInterval = setInterval(pollCurrentPointerOnce, 2000);
}

/* ================================
   SUBMIT RESULT (Timer + DQ)
   (still goes to GAS)
================================ */
async function submitResult() {
  if (!uniqueId) {
    alert('Lane not loaded properly. Cannot submit.');
    return;
  }

  const dq = document.getElementById('dqCheckbox').checked ? 'Yes' : 'No';
  const finalTime = document.getElementById('timerDisplay').textContent;

  // Optional guard: prevent submitting if time never started
  if (finalTime === '00:00.00') {
    const proceed = confirm(
      'Timer shows 00:00.00. Are you sure you want to submit this result?'
    );
    if (!proceed) return;
  }

  const payload = {
    action: 'submitResult',
    uniqueId,
    finalTime,
    dq,
  };

  try {
    const res = await fetch(API, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    if (result.ok) {
      alert('Saved!');
      stopTimer(); // lock timer after saving
    } else {
      console.error('Submit error:', result);
      alert('Error saving result');
    }
  } catch (err) {
    console.error('Network/submit error:', err);
    alert('Error contacting server while saving result.');
  }
}

/* ================================
   MANUAL CONTROLS (buttons)
================================ */
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const submitBtn = document.getElementById('submitBtn');

if (startBtn) {
  startBtn.onclick = () => {
    // Manual local start (and also used by ESP32 "fake click")
    startTimerLocal();
  };
}

if (stopBtn) {
  stopBtn.onclick = () => {
    stopTimer();
  };
}

if (submitBtn) {
  submitBtn.onclick = () => {
    submitResult();
  };
}

/* ================================
   ESP32 WEBSOCKET HOOK
   - ESP32 triggers cmd=start / cmd=stop / cmd=reset
   (timing is local, no GAS startTs)
================================ */
let espSocket = null;

function connectToEsp32() {
  try {
    espSocket = new WebSocket(ESP32_WS_URL);

    espSocket.onopen = () => {
      console.log('✅ Connected to ESP32 WebSocket');
      const btStatus = document.getElementById('btStatus');
      if (btStatus) {
        btStatus.textContent = 'Bluetooth: Connected (ESP32 Wi-Fi Trigger)';
      }
    };

    espSocket.onclose = () => {
      console.log('⚠️ ESP32 WebSocket closed, retrying in 2s...');
      const btStatus = document.getElementById('btStatus');
      if (btStatus) {
        btStatus.textContent = 'Bluetooth: Not Connected';
      }
      setTimeout(connectToEsp32, 2000);
    };

    espSocket.onerror = (err) => {
      console.error('ESP32 WebSocket error:', err);
    };

    espSocket.onmessage = (event) => {
      const msg = String(event.data || '').trim();
      console.log('📡 ESP32 message:', msg);

      // Expecting messages like:
      //  "source=esp32&cmd=start&event=1&heat=1"
      //  "source=esp32&cmd=stop"
      //  "source=esp32&cmd=reset"
      const params = new URLSearchParams(msg);
      const cmd = params.get('cmd');

      if (cmd === 'start') {
        const ev = params.get('event');
        const ht = params.get('heat');
        // Only react if this lane is on the same Event/Heat
        if (
          ev &&
          ht &&
          String(ev) === String(eventNo) &&
          String(ht) === String(heatNo)
        ) {
          if (startBtn) startBtn.click();
        } else if (!ev && !ht) {
          // If ESP32 doesn't send event/heat, just start anyway
          if (startBtn) startBtn.click();
        }
      } else if (cmd === 'stop') {
        if (stopBtn) stopBtn.click();
      } else if (cmd === 'reset') {
        resetLaneTimer();
      }
    };
  } catch (e) {
    console.error('Failed to create WebSocket:', e);
    setTimeout(connectToEsp32, 2000);
  }
}

/* ================================
   AUTO INIT
================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Initial UI
  resetLaneTimer();

  // Lane + initial Event/Heat from URL
  getParams();

  // ✅ NEW: If URL already has event & heat, load swimmer immediately
  if (eventNo && heatNo && lane && lane !== '?') {
    loadLaneData(); // fills swimmerName, swimmerSchool, laneStatus
  }

  // Then start following the starter pointer for subsequent races
  startPointerPolling();

  // Connect to ESP32 for real-time start/stop
  connectToEsp32();
});
