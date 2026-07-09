// viewer.js
import { db, collection, onSnapshot, query, orderBy, limit } from './firebase-init.js';
import { computeStandings } from './scheduler.js';

const tournamentsCol = collection(db, 'tournaments');
const nameEl = document.getElementById('viewer-tournament-name');
const statusEl = document.getElementById('viewer-status');
const contentEl = document.getElementById('viewer-content');

// Order by createdAt only (single-field index, no Firestore composite index
// needed) and pick the best candidate client-side: prefer an active
// tournament, otherwise fall back to the most recently completed one.
onSnapshot(query(tournamentsCol, orderBy('createdAt', 'desc'), limit(10)), snap => {
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const active = docs.find(t => t.status === 'active');
  const fallback = docs.find(t => t.status === 'completed');
  render(active || fallback || null, !!active);
});

function playerName(players, id) {
  const p = players.find(pl => pl.id === id);
  return p ? p.name : 'â€”';
}

function render(t, isLive) {
  if (!t) {
    nameEl.textContent = 'Court Sheet';
    statusEl.style.display = 'none';
    contentEl.innerHTML = `
      <div class="empty-state">
        <h3>Waiting for a tournamentâ€¦</h3>
        <p>Nothing is currently in progress. Check back once the organiser starts one.</p>
      </div>`;
    return;
  }

  nameEl.textContent = t.name;
  statusEl.style.display = '';
  statusEl.textContent = isLive ? 'Live' : 'Final result';
  statusEl.style.color = isLive ? '' : 'var(--slate-light)';

  const players = t.players || [];
  const rounds = t.rounds || [];
  const standings = computeStandings(players, rounds);

  let roundHtml = '';
  if (isLive) {
    const round = rounds[rounds.length - 1];
    if (round) {
      const sitoutHtml = round.sitOut.length
        ? `<p class="sitout-note">Sitting out this round: ${round.sitOut.map(id => playerName(players, id)).join(', ')}</p>`
        : '';
      const cardsHtml = round.matches.map(m => `
        <div class="court-card${m.completed ? ' court-card--done' : ''}">
          <div class="court-card__label">Court ${m.court}${m.completed ? ' Â· Recorded' : ' Â· Playing'}</div>
          <div class="court-card__team court-card__team--a">
            <div class="court-card__names">${escapeHtml(playerName(players, m.teamA[0]))}<br>${escapeHtml(playerName(players, m.teamA[1]))}</div>
          </div>
          <div class="court-card__score">
            <span>${m.scoreA ?? 'â€“'}</span><span class="dash">â€“</span><span>${m.scoreB ?? 'â€“'}</span>
          </div>
          <div class="court-card__team court-card__team--b">
            <div class="court-card__names">${escapeHtml(playerName(players, m.teamB[0]))}<br>${escapeHtml(playerName(players, m.teamB[1]))}</div>
          </div>
        </div>
      `).join('');

      roundHtml = `
        <div class="round-heading"><h2>Round ${round.roundNumber}</h2></div>
        ${sitoutHtml}
        <div class="court-cards">${cardsHtml}</div>
      `;
    } else {
      roundHtml = `<div class="empty-state"><h3>About to begin</h3><p>The organiser is setting up the first round.</p></div>`;
    }
  } else {
    const winner = standings[0];
    roundHtml = `
      <div class="empty-state" style="padding-top:0.5rem;">
        <h3>${winner ? `ðŸ† ${escapeHtml(winner.name)}` : 'Tournament complete'}</h3>
        <p>${winner ? `Won with ${winner.points} points` : ''}</p>
      </div>
    `;
  }

  const standingsRows = standings.map((s, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td>${escapeHtml(s.name)}</td>
      <td class="num">${s.points}</td>
      <td class="num">${s.roundsPlayed}</td>
      <td class="num">${s.avg}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--slate-light);">No scores recorded yet.</td></tr>';

  contentEl.innerHTML = `
    ${roundHtml}
    <div class="card" style="background:var(--ink-soft); border-color:var(--line);">
      <h2>Standings</h2>
      <table class="standings">
        <thead>
          <tr><th class="rank">#</th><th>Player</th><th class="num">Points</th><th class="num">Rounds</th><th class="num">Avg</th></tr>
        </thead>
        <tbody>${standingsRows}</tbody>
      </table>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}