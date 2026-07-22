// social.js
import {
  db, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, limit, serverTimestamp
} from './firebase-init.js';
import { generateNextSocialRound, computeSocialStats } from './scheduler.js';

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
const membersCol = collection(db, 'members');
const sessionsCol = collection(db, 'sessions');

let membersCache = [];
let currentId = null;
let currentData = null;
let unsubCurrent = null;

const screens = {
  list: document.getElementById('screen-list'),
  live: document.getElementById('screen-live'),
  done: document.getElementById('screen-done')
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.style.display = key === name ? '' : 'none';
  });
  document.getElementById('btn-topbar-back').style.display = name === 'list' ? 'none' : '';
}

function stopWatchingCurrent() {
  if (unsubCurrent) { unsubCurrent(); unsubCurrent = null; }
  currentId = null;
  currentData = null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function ratingLabel(rating) {
  return `${rating}`;
}

// ---------------------------------------------------------------
// Member directory (persistent, reused across every session)
// ---------------------------------------------------------------
onSnapshot(query(membersCol, orderBy('name')), snap => {
  membersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderMemberDirectory();
  renderCheckinSuggestions();
});

document.getElementById('form-add-member').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('member-name').value.trim();
  const rating = parseInt(document.getElementById('member-rating').value, 10);
  const gender = document.getElementById('member-gender').value;
  if (!name) return;
  await addDoc(membersCol, { name, rating, gender, createdAt: serverTimestamp() });
  document.getElementById('form-add-member').reset();
  document.getElementById('member-rating').value = '3';
});

document.getElementById('member-search').addEventListener('input', renderMemberDirectory);

function renderMemberDirectory() {
  const search = document.getElementById('member-search').value.trim().toLowerCase();
  const list = document.getElementById('member-directory-list');
  const filtered = search
    ? membersCache.filter(m => m.name.toLowerCase().includes(search))
    : membersCache;

  if (filtered.length === 0) {
    list.innerHTML = '<p style="color:var(--slate);">No players in the directory yet.</p>';
    return;
  }

  list.innerHTML = filtered.map(m => `
    <div class="tourn-row">
      <div class="tourn-row__meta">
        <span class="tourn-row__name" style="font-size:0.95rem;">${escapeHtml(m.name)}</span>
        <span class="tag">Rating ${ratingLabel(m.rating)}</span>
        ${m.gender ? `<span class="tag">${m.gender === 'F' ? 'Female' : 'Male'}</span>` : ''}
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button type="button" class="btn btn--small btn--ghost" data-edit-member="${m.id}">Edit</button>
        <button type="button" class="btn btn--small btn--danger" data-remove-member="${m.id}">Remove</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-edit-member]').forEach(btn => {
    btn.addEventListener('click', () => editMember(btn.getAttribute('data-edit-member')));
  });
  list.querySelectorAll('[data-remove-member]').forEach(btn => {
    btn.addEventListener('click', () => removeMember(btn.getAttribute('data-remove-member')));
  });
}

async function editMember(id) {
  const member = membersCache.find(m => m.id === id);
  if (!member) return;
  const newName = prompt('Player name:', member.name);
  if (newName === null) return;
  const trimmedName = newName.trim();
  if (!trimmedName) return;
  const newRating = prompt('Rating (1-5):', member.rating);
  if (newRating === null) return;
  const rating = Math.min(5, Math.max(1, parseInt(newRating, 10) || member.rating));
  await updateDoc(doc(db, 'members', id), { name: trimmedName, rating });
}

async function removeMember(id) {
  const member = membersCache.find(m => m.id === id);
  if (!member) return;
  if (!confirm(`Remove ${member.name} from the directory? This won't affect any past or current session they've played in.`)) return;
  await deleteDoc(doc(db, 'members', id));
}

// ---------------------------------------------------------------
// Session list
// ---------------------------------------------------------------
const sessionListEl = document.getElementById('session-list');

onSnapshot(query(sessionsCol, orderBy('createdAt', 'desc'), limit(25)), snap => {
  if (snap.empty) {
    sessionListEl.innerHTML = '<div class="empty-state"><p>No sessions yet - create one above.</p></div>';
    return;
  }
  sessionListEl.innerHTML = '';
  snap.forEach(d => {
    const s = d.data();
    const row = document.createElement('div');
    row.className = 'tourn-row';
    const statusTag = s.status === 'active' ? 'tag--live' : 'tag--done';
    const activeCount = (s.players || []).filter(p => p.active !== false).length;
    row.innerHTML = `
      <div class="tourn-row__meta">
        <span class="tourn-row__name">${escapeHtml(s.name)}</span>
        <span class="tag ${statusTag}">${s.status}</span>
        <span style="color:var(--slate); font-size:0.85rem;">${activeCount} checked in - ${(s.players || []).length} total</span>
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button class="btn btn--small btn--primary" data-open="${d.id}">Open</button>
      </div>
    `;
    sessionListEl.appendChild(row);
  });
  sessionListEl.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => openSession(btn.getAttribute('data-open')));
  });
}, err => {
  console.error('Session list failed to load:', err);
  sessionListEl.innerHTML = `<div class="empty-state"><h3>Couldn't load sessions</h3><p>${escapeHtml(err.message)}</p></div>`;
});

document.getElementById('form-new-session').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('new-session-name').value.trim();
  const courts = parseInt(document.getElementById('new-session-courts').value, 10);
  const preferMixedDoubles = document.getElementById('new-session-mixed').value === 'yes';
  const genderAdjustment = parseFloat(document.getElementById('new-session-gender-adjust').value);
  if (!name) return;

  const docRef = await addDoc(sessionsCol, {
    name,
    courts,
    preferMixedDoubles,
    genderAdjustment,
    status: 'active',
    players: [],
    rounds: [],
    createdAt: serverTimestamp()
  });
  document.getElementById('form-new-session').reset();
  document.getElementById('new-session-courts').value = '2';
  document.getElementById('new-session-mixed').value = 'yes';
  document.getElementById('new-session-gender-adjust').value = '1';
  openSession(docRef.id);
});

// ---------------------------------------------------------------
// Open / watch a session
// ---------------------------------------------------------------
function openSession(id) {
  stopWatchingCurrent();
  currentId = id;
  const url = new URL(window.location);
  url.searchParams.set('s', id);
  window.history.replaceState({}, '', url);

  const ref = doc(db, 'sessions', id);
  unsubCurrent = onSnapshot(ref, snap => {
    if (!snap.exists()) { backToList(); return; }
    currentData = snap.data();
    render();
  }, err => {
    console.error('Failed to load session:', err);
    alert(`Couldn't load that session: ${err.message}`);
    backToList();
  });
}

function backToList() {
  stopWatchingCurrent();
  const url = new URL(window.location);
  url.searchParams.delete('s');
  window.history.replaceState({}, '', url);
  showScreen('list');
}

function saveCurrent(patch) {
  if (!currentId) return;
  return updateDoc(doc(db, 'sessions', currentId), patch);
}

document.getElementById('btn-topbar-back').addEventListener('click', backToList);
document.getElementById('btn-done-back').addEventListener('click', backToList);

function render() {
  if (!currentData) return;
  if (currentData.status === 'completed') { renderDone(); showScreen('done'); }
  else { renderLive(); showScreen('live'); }
}

// ---------------------------------------------------------------
// Check-in: add regular players from the directory
// ---------------------------------------------------------------
document.getElementById('checkin-search').addEventListener('input', renderCheckinSuggestions);

function renderCheckinSuggestions() {
  const container = document.getElementById('checkin-suggestions');
  if (!currentData || currentData.status !== 'active') { container.innerHTML = ''; return; }

  const search = document.getElementById('checkin-search').value.trim().toLowerCase();
  if (!search) { container.innerHTML = ''; return; }

  const inSessionMemberIds = new Set(
    (currentData.players || []).filter(p => p.memberId && p.active !== false).map(p => p.memberId)
  );

  const matches = membersCache
    .filter(m => m.name.toLowerCase().includes(search) && !inSessionMemberIds.has(m.id))
    .slice(0, 8);

  if (matches.length === 0) {
    container.innerHTML = '<span style="color:var(--slate);">No matches - use "Add a guest" below if they are not in the directory.</span>';
    return;
  }

  container.innerHTML = matches.map(m => `
    <span class="chip">
      ${escapeHtml(m.name)} (${ratingLabel(m.rating)})
      <button type="button" class="chip__edit" data-checkin="${m.id}">Check in</button>
    </span>
  `).join('');

  container.querySelectorAll('[data-checkin]').forEach(btn => {
    btn.addEventListener('click', () => checkInMember(btn.getAttribute('data-checkin')));
  });
}

function checkInMember(memberId) {
  const member = membersCache.find(m => m.id === memberId);
  if (!member || !currentData) return;

  const players = [...(currentData.players || [])];
  const existing = players.find(p => p.memberId === memberId);
  if (existing) {
    existing.active = true;
  } else {
    players.push({
      id: crypto.randomUUID(),
      memberId,
      name: member.name,
      rating: member.rating,
      gender: member.gender || '',
      active: true
    });
  }
  saveCurrent({ players });
  document.getElementById('checkin-search').value = '';
  renderCheckinSuggestions();
}

document.getElementById('form-add-guest').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('guest-name').value.trim();
  const rating = parseInt(document.getElementById('guest-rating').value, 10);
  const gender = document.getElementById('guest-gender').value;
  if (!name || !currentData) return;

  const players = [...(currentData.players || []), {
    id: crypto.randomUUID(),
    memberId: null,
    name,
    rating,
    gender,
    active: true
  }];
  saveCurrent({ players });
  document.getElementById('form-add-guest').reset();
  document.getElementById('guest-rating').value = '3';
});

function setPlayerActive(playerId, active) {
  const players = (currentData.players || []).map(p => p.id === playerId ? { ...p, active } : p);
  saveCurrent({ players });
}

// ---------------------------------------------------------------
// Checked-in roster display
// ---------------------------------------------------------------
function renderCheckedInChips() {
  const players = currentData.players || [];
  const active = players.filter(p => p.active !== false);
  const inactive = players.filter(p => p.active === false);

  document.getElementById('checked-in-count').textContent = active.length;

  const chipsEl = document.getElementById('checked-in-chips');
  if (active.length === 0 && inactive.length === 0) {
    chipsEl.innerHTML = '<span style="color:var(--slate);">No one checked in yet.</span>';
    return;
  }

  let html = active.map(p => `
    <span class="chip">
      ${escapeHtml(p.name)} (${ratingLabel(p.rating)})
      <button type="button" class="chip__remove" data-checkout="${p.id}" aria-label="Check out ${escapeHtml(p.name)}">&times;</button>
    </span>
  `).join('');

  if (inactive.length > 0) {
    html += inactive.map(p => `
      <span class="chip" style="opacity:0.6;">
        ${escapeHtml(p.name)} (left)
        <button type="button" class="chip__edit" data-checkin-back="${p.id}">Check back in</button>
      </span>
    `).join('');
  }

  chipsEl.innerHTML = html;
  chipsEl.querySelectorAll('[data-checkout]').forEach(btn => {
    btn.addEventListener('click', () => setPlayerActive(btn.getAttribute('data-checkout'), false));
  });
  chipsEl.querySelectorAll('[data-checkin-back]').forEach(btn => {
    btn.addEventListener('click', () => setPlayerActive(btn.getAttribute('data-checkin-back'), true));
  });
}

// ---------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------
document.getElementById('btn-generate-round').addEventListener('click', () => {
  if (!currentData) return;
  try {
    const round = generateNextSocialRound(
      currentData.players || [],
      currentData.rounds || [],
      currentData.courts || 2,
      { preferMixedDoubles: currentData.preferMixedDoubles, genderAdjustment: currentData.genderAdjustment || 0 }
    );
    const rounds = [...(currentData.rounds || []), round];
    saveCurrent({ rounds });
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('btn-finish-session').addEventListener('click', () => {
  if (!confirm('Finish this session? You can still review it afterwards, but no further rounds can be generated.')) return;
  saveCurrent({ status: 'completed', completedAt: serverTimestamp() });
});

function playerName(players, id) {
  const p = players.find(pl => pl.id === id);
  return p ? p.name : '-';
}

function playerRating(players, id) {
  const p = players.find(pl => pl.id === id);
  return p ? p.rating : '';
}

function buildSocialMatchCard(players, match) {
  const card = document.createElement('div');
  card.className = 'court-card';
  card.innerHTML = `
    <div class="court-card__label">Court ${match.court}</div>
    <div class="court-card__team court-card__team--a">
      <div class="court-card__names">
        ${escapeHtml(playerName(players, match.teamA[0]))} (${playerRating(players, match.teamA[0])})<br>
        ${escapeHtml(playerName(players, match.teamA[1]))} (${playerRating(players, match.teamA[1])})
      </div>
    </div>
    <div class="court-card__score"><span class="dash">v</span></div>
    <div class="court-card__team court-card__team--b">
      <div class="court-card__names">
        ${escapeHtml(playerName(players, match.teamB[0]))} (${playerRating(players, match.teamB[0])})<br>
        ${escapeHtml(playerName(players, match.teamB[1]))} (${playerRating(players, match.teamB[1])})
      </div>
    </div>
  `;
  return card;
}

function renderLive() {
  document.getElementById('live-session-title').textContent = currentData.name;
  const mixedLabel = currentData.preferMixedDoubles ? 'Mixed doubles preferred' : 'No mixed doubles preference';
  const genderAdjust = currentData.genderAdjustment || 0;
  const genderLabel = genderAdjust === 0 ? 'no gender adjustment' : `gender gap adjustment ${genderAdjust}`;
  document.getElementById('live-session-settings').textContent = `${mixedLabel} - ${genderLabel} - ${currentData.courts} court${currentData.courts === 1 ? '' : 's'}`;
  renderCheckedInChips();

  const players = currentData.players || [];
  const rounds = currentData.rounds || [];
  const roundIndex = rounds.length - 1;
  const round = rounds[roundIndex];

  document.getElementById('live-round-title').textContent = round ? `Round ${round.roundNumber}` : 'No rounds yet';

  const sitoutNote = document.getElementById('live-sitout-note');
  sitoutNote.textContent = round && round.sitOut.length
    ? `Sitting out this round: ${round.sitOut.map(id => playerName(players, id)).join(', ')}`
    : '';

  const cardsEl = document.getElementById('live-court-cards');
  cardsEl.innerHTML = '';
  if (!round) {
    cardsEl.innerHTML = '<div class="empty-state"><h3>Ready to begin</h3><p>Check in at least 4 players, then click "Generate next round".</p></div>';
  } else {
    round.matches.forEach(m => cardsEl.appendChild(buildSocialMatchCard(players, m)));
  }

  renderPreviousRounds(players, rounds, roundIndex);

  const statsBody = document.getElementById('live-stats-body');
  const stats = computeSocialStats(players, rounds);
  statsBody.innerHTML = stats.map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td class="num">${s.gamesPlayed}</td>
      <td class="num">${s.satOut}</td>
      <td><span class="tag ${s.active ? 'tag--live' : ''}">${s.active ? 'Here' : 'Left'}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="4" style="text-align:center; color:var(--slate);">No players yet.</td></tr>';
}

function renderPreviousRounds(players, rounds, currentRoundIndex) {
  const container = document.getElementById('live-previous-rounds');
  container.innerHTML = '';
  const previous = rounds.slice(0, currentRoundIndex);
  if (previous.length === 0) return;

  const details = document.createElement('details');
  details.className = 'collapsible';
  const summary = document.createElement('summary');
  summary.textContent = `Previous rounds (${previous.length})`;
  details.appendChild(summary);

  for (let i = previous.length - 1; i >= 0; i--) {
    const round = previous[i];
    const heading = document.createElement('div');
    heading.className = 'round-heading';
    heading.innerHTML = `<h2 style="font-size:1.1rem;">Round ${round.roundNumber}</h2>`;
    if (round.sitOut.length) {
      heading.innerHTML += `<span class="sitout-note" style="margin:0;">Sat out: ${round.sitOut.map(id => escapeHtml(playerName(players, id))).join(', ')}</span>`;
    }
    details.appendChild(heading);

    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'court-cards';
    round.matches.forEach(m => cardsWrap.appendChild(buildSocialMatchCard(players, m)));
    details.appendChild(cardsWrap);
  }

  container.appendChild(details);
}

// ---------------------------------------------------------------
// Done screen
// ---------------------------------------------------------------
function renderDone() {
  document.getElementById('done-title').textContent = currentData.name;
  const stats = computeSocialStats(currentData.players || [], currentData.rounds || []);
  document.getElementById('done-stats-body').innerHTML = stats.map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td class="num">${s.gamesPlayed}</td>
      <td class="num">${s.satOut}</td>
    </tr>
  `).join('') || '<tr><td colspan="3" style="text-align:center; color:var(--slate);">No rounds were played.</td></tr>';
}

// ---------------------------------------------------------------
// Boot: resume from the URL (?s=<id>), or auto-resume whichever
// session is still active, so a refresh doesn't strand the organiser.
// ---------------------------------------------------------------
function boot() {
  const urlId = new URL(window.location).searchParams.get('s');
  if (urlId) {
    openSession(urlId);
    return;
  }

  let unsubBoot = null;
  let handled = false;
  unsubBoot = onSnapshot(query(sessionsCol, orderBy('createdAt', 'desc'), limit(10)), snap => {
    if (handled) return;
    handled = true;
    if (unsubBoot) unsubBoot();

    const inProgress = snap.docs.find(d => d.data().status === 'active');
    if (inProgress) {
      openSession(inProgress.id);
    } else {
      showScreen('list');
    }
  }, err => {
    console.error('Boot query failed:', err);
    showScreen('list');
  });
}

boot();
