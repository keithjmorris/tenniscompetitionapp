// admin.js
import {
  db, collection, doc, addDoc, updateDoc, onSnapshot,
  query, orderBy, limit, serverTimestamp
} from './firebase-init.js';
import { generateNextRound, computeStandings } from './scheduler.js';

// -------------------------------------------------------------- - 
// Optional lightweight PIN gate. This is NOT real security - it just
// keeps casual visitors from poking at the admin page. Set a PIN below
// to enable it, or leave as null to skip the gate entirely. For real
// protection (e.g. a public repo / public URL you don't trust), add
// Firebase Authentication instead.
// -------------------------------------------------------------- - 
const ADMIN_PIN = null; // e.g. '2468'

function checkPin() {
  if (!ADMIN_PIN) return true;
  if (sessionStorage.getItem('courtsheet_admin_ok') === 'yes') return true;
  const entered = prompt('Enter admin PIN:');
  if (entered === ADMIN_PIN) {
    sessionStorage.setItem('courtsheet_admin_ok', 'yes');
    return true;
  }
  return false;
}

if (!checkPin()) {
  document.body.innerHTML = '<div class="empty-state"><h3>Access denied</h3></div>';
  throw new Error('PIN check failed');
}

// -------------------------------------------------------------- - 
// State
// -------------------------------------------------------------- - 
const tournamentsCol = collection(db, 'tournaments');
let currentId = null;
let currentData = null;
let unsubCurrent = null;

const screens = {
  list: document.getElementById('screen-list'),
  setup: document.getElementById('screen-setup'),
  live: document.getElementById('screen-live'),
  done: document.getElementById('screen-done')
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.style.display = key === name ? '' : 'none';
  });
}

function stopWatchingCurrent() {
  if (unsubCurrent) { unsubCurrent(); unsubCurrent = null; }
  currentId = null;
  currentData = null;
}

// -------------------------------------------------------------- - 
// Tournament list
// -------------------------------------------------------------- - 
const listEl = document.getElementById('tournament-list');

onSnapshot(query(tournamentsCol, orderBy('createdAt', 'desc'), limit(25)), snap => {
  if (snap.empty) {
    listEl.innerHTML = '<div class="empty-state"><p>No tournaments yet - create one above.</p></div>';
    return;
  }
  listEl.innerHTML = '';
  snap.forEach(d => {
    const t = d.data();
    const row = document.createElement('div');
    row.className = 'tourn-row';
    const statusTag = t.status === 'active' ? 'tag--live' : (t.status === 'completed' ? 'tag--done' : '');
    row.innerHTML = `
      <div class="tourn-row__meta">
        <span class="tourn-row__name">${escapeHtml(t.name)}</span>
        <span class="tag ${statusTag}">${t.status}</span>
        <span style="color:var(--slate); font-size:0.85rem;">${(t.players || []).length} players - ${t.pointsPerRound} pts</span>
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button class="btn btn--small btn--primary" data-open="${d.id}">Open</button>
      </div>
    `;
    listEl.appendChild(row);
  });

  listEl.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => openTournament(btn.getAttribute('data-open')));
  });
});

// -------------------------------------------------------------- - 
// Create tournament
// -------------------------------------------------------------- - 
document.getElementById('form-new-tournament').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('new-name').value.trim();
  const pointsPerRound = parseInt(document.getElementById('new-points').value, 10);
  const courts = parseInt(document.getElementById('new-courts').value, 10);
  if (!name) return;

  const docRef = await addDoc(tournamentsCol, {
    name,
    pointsPerRound,
    courts,
    status: 'setup',
    players: [],
    rounds: [],
    createdAt: serverTimestamp()
  });
  document.getElementById('form-new-tournament').reset();
  document.getElementById('new-points').value = '24';
  document.getElementById('new-courts').value = '2';
  openTournament(docRef.id);
});

// -------------------------------------------------------------- - 
// Open / watch a specific tournament
// -------------------------------------------------------------- - 
function openTournament(id) {
  stopWatchingCurrent();
  currentId = id;
  const ref = doc(db, 'tournaments', id);
  unsubCurrent = onSnapshot(ref, snap => {
    if (!snap.exists()) { showScreen('list'); return; }
    currentData = snap.data();
    render();
  });
}

function saveCurrent(patch) {
  if (!currentId) return;
  return updateDoc(doc(db, 'tournaments', currentId), patch);
}

// -------------------------------------------------------------- - 
// Render router
// -------------------------------------------------------------- - 
function render() {
  if (!currentData) return;
  if (currentData.status === 'setup') { renderSetup(); showScreen('setup'); }
  else if (currentData.status === 'active') { renderLive(); showScreen('live'); }
  else if (currentData.status === 'completed') { renderDone(); showScreen('done'); }
}

// -------------------------------------------------------------- - 
// SETUP screen
// -------------------------------------------------------------- - 
document.getElementById('form-add-player').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('player-name');
  const name = input.value.trim();
  if (!name || !currentData) return;
  const players = [...(currentData.players || []), { id: crypto.randomUUID(), name }];
  saveCurrent({ players });
  input.value = '';
  input.focus();
});

function removePlayer(id) {
  const players = (currentData.players || []).filter(p => p.id !== id);
  saveCurrent({ players });
}

document.getElementById('btn-back-to-list').addEventListener('click', () => {
  stopWatchingCurrent();
  showScreen('list');
});

document.getElementById('btn-start-tournament').addEventListener('click', () => {
  if (!currentData || (currentData.players || []).length < 4) return;
  saveCurrent({ status: 'active', startedAt: serverTimestamp() });
});

function renderSetup() {
  document.getElementById('setup-title').textContent = currentData.name;
  const players = currentData.players || [];

  const chipsEl = document.getElementById('player-chips');
  chipsEl.innerHTML = '';
  if (players.length === 0) {
    chipsEl.innerHTML = '<span style="color:var(--slate);">No players added yet.</span>';
  }
  players.forEach(p => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(p.name)} <button type="button" aria-label="Remove ${escapeHtml(p.name)}">&times;</button>`;
    chip.querySelector('button').addEventListener('click', () => removePlayer(p.id));
    chipsEl.appendChild(chip);
  });

  document.getElementById('player-count-label').textContent =
    `${players.length} player${players.length === 1 ? '' : 's'} added`;

  const startBtn = document.getElementById('btn-start-tournament');
  startBtn.disabled = players.length < 4;
}

// -------------------------------------------------------------- - 
// LIVE screen
// -------------------------------------------------------------- - 
document.getElementById('btn-generate-round').addEventListener('click', () => {
  if (!currentData) return;
  try {
    const round = generateNextRound(currentData.players, currentData.rounds || [], currentData.courts || 2);
    const rounds = [...(currentData.rounds || []), round];
    saveCurrent({ rounds });
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('btn-finish-tournament').addEventListener('click', () => {
  if (!confirm('Finish this tournament? Final standings will be locked in.')) return;
  saveCurrent({ status: 'completed', completedAt: serverTimestamp() });
});

function playerName(id) {
  const p = (currentData.players || []).find(pl => pl.id === id);
  return p ? p.name : ' - ';
}

function updateMatchScore(roundIndex, matchIndex, field, value) {
  const rounds = JSON.parse(JSON.stringify(currentData.rounds || []));
  const match = rounds[roundIndex].matches[matchIndex];
  const target = currentData.pointsPerRound;
  const n = value === '' ? null : Math.max(0, parseInt(value, 10) || 0);
  match[field] = n;

  // Auto-fill the other team's score so the pair sums to the round's points
  // target (e.g. entering 13 out of 24 sets the other team to 11). The
  // organiser can still overwrite either box manually afterwards.
  if (n !== null && target) {
    const otherField = field === 'scoreA' ? 'scoreB' : 'scoreA';
    match[otherField] = Math.max(0, target - n);
  }

  match.completed = match.scoreA !== null && match.scoreB !== null;
  saveCurrent({ rounds });
}

function renderLive() {
  const rounds = currentData.rounds || [];
  const roundIndex = rounds.length - 1;
  const round = rounds[roundIndex];

  document.getElementById('live-round-title').textContent =
    round ? `Round ${round.roundNumber}` : 'No rounds yet';

  const sitoutNote = document.getElementById('live-sitout-note');
  if (round && round.sitOut.length) {
    sitoutNote.textContent = `Sitting out this round: ${round.sitOut.map(playerName).join(', ')}`;
  } else {
    sitoutNote.textContent = '';
  }

  const cardsEl = document.getElementById('live-court-cards');
  cardsEl.innerHTML = '';

  if (!round) {
    cardsEl.innerHTML = '<div class="empty-state"><h3>Ready to begin</h3><p>Click "Generate next round" to create the first set of matches.</p></div>';
  } else {
    round.matches.forEach((m, mi) => {
      const card = document.createElement('div');
      card.className = 'court-card' + (m.completed ? ' court-card--done' : '');
      card.innerHTML = `
        <div class="court-card__label">Court ${m.court}${m.completed ? ' - Recorded' : ' - Live'}</div>
        <div class="court-card__team court-card__team--a">
          <div class="court-card__names">${escapeHtml(playerName(m.teamA[0]))}<br>${escapeHtml(playerName(m.teamA[1]))}</div>
        </div>
        <div class="court-card__score">
          <input type="number" min="0" class="court-card__score-input" data-team="A" value="${m.scoreA ?? ''}" aria-label="Team A score">
          <span class="dash">v</span>
          <input type="number" min="0" class="court-card__score-input" data-team="B" value="${m.scoreB ?? ''}" aria-label="Team B score">
        </div>
        <div class="court-card__team court-card__team--b">
          <div class="court-card__names">${escapeHtml(playerName(m.teamB[0]))}<br>${escapeHtml(playerName(m.teamB[1]))}</div>
        </div>
      `;
      card.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', () => {
          const field = inp.getAttribute('data-team') === 'A' ? 'scoreA' : 'scoreB';
          updateMatchScore(roundIndex, mi, field, inp.value);
        });
      });
      cardsEl.appendChild(card);
    });
  }

  const hint = document.getElementById('live-round-hint');
  if (round && round.matches.some(m => !m.completed)) {
    hint.textContent = 'Tip: you can generate the next round before finishing this one if you need to.';
  } else {
    hint.textContent = '';
  }

  renderStandingsInto('live-standings-body');
}

function renderStandingsInto(tbodyId) {
  const standings = computeStandings(currentData.players || [], currentData.rounds || []);
  const body = document.getElementById(tbodyId);
  body.innerHTML = '';
  standings.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rank">${i + 1}</td>
      <td>${escapeHtml(s.name)}</td>
      <td class="num">${s.points}</td>
      <td class="num">${s.roundsPlayed}</td>
      <td class="num">${s.roundsWon}</td>
      <td class="num">${s.pointDiff > 0 ? '+' : ''}${s.pointDiff}</td>
    `;
    body.appendChild(tr);
  });
  if (standings.length === 0) {
    body.innerHTML = '<tr><td colspan="6" style="color:var(--slate); text-align:center;">No scores recorded yet.</td></tr>';
  }
}

// -------------------------------------------------------------- - 
// DONE screen
// -------------------------------------------------------------- - 
document.getElementById('btn-done-back').addEventListener('click', () => {
  stopWatchingCurrent();
  showScreen('list');
});

function renderDone() {
  document.getElementById('done-title').textContent = currentData.name;
  const standings = computeStandings(currentData.players || [], currentData.rounds || []);
  const winner = standings[0];
  document.getElementById('done-winner').textContent = winner
    ? `ðŸ† ${winner.name} - ${winner.points} points`
    : 'No scores were recorded.';
  renderStandingsInto('done-standings-body');
}

// -------------------------------------------------------------- - 
// Utils
// -------------------------------------------------------------- - 
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

showScreen('list');