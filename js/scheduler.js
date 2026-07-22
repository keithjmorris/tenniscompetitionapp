// scheduler.js
// Americano round-generation engine for a club with a FIXED number of courts
// (default 2). Pure functions only - no Firebase, no DOM - so this file can
// be tested or reused on its own.
//
// Data shapes used throughout:
//   player  = { id: string, name: string }
//   match   = { court: number, teamA: [id, id], teamB: [id, id],
//               scoreA: number|null, scoreB: number|null, completed: boolean }
//   round   = { roundNumber: number, sitOut: [id...], matches: [match...] }

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

/**
 * Rebuild partner/opponent/play/sit-out history from the rounds played so far.
 * Only completed rounds should normally be passed in, but this works either way
 * since it just counts how players have been grouped, not the scores.
 */
export function buildHistory(players, rounds) {
  const history = {
    partner: {},     // pairKey -> times played as partners
    opponent: {},    // pairKey -> times played as opponents
    playCount: {},   // playerId -> rounds played
    sitOutCount: {}  // playerId -> rounds sat out
  };

  players.forEach(p => {
    history.playCount[p.id] = 0;
    history.sitOutCount[p.id] = 0;
  });

  rounds.forEach(round => {
    round.sitOut.forEach(id => {
      if (history.sitOutCount[id] !== undefined) history.sitOutCount[id]++;
    });
    round.matches.forEach(match => {
      const [a1, a2] = match.teamA;
      const [b1, b2] = match.teamB;

      [a1, a2, b1, b2].forEach(id => {
        if (history.playCount[id] !== undefined) history.playCount[id]++;
      });

      const pkA = pairKey(a1, a2);
      history.partner[pkA] = (history.partner[pkA] || 0) + 1;
      const pkB = pairKey(b1, b2);
      history.partner[pkB] = (history.partner[pkB] || 0) + 1;

      [a1, a2].forEach(x => {
        [b1, b2].forEach(y => {
          const ok = pairKey(x, y);
          history.opponent[ok] = (history.opponent[ok] || 0) + 1;
        });
      });
    });
  });

  return history;
}

/**
 * Decide who plays this round and who sits out.
 * Priority to play: most sit-outs so far, then fewest rounds played, then random.
 * The playing pool size is always a multiple of 4 (so courts fill with full 2v2 matches),
 * capped at courts * 4.
 */
function choosePlayingPool(players, history, courts) {
  const maxPlayers = courts * 4;
  const activeIds = players.map(p => p.id);

  const sorted = [...activeIds].sort((a, b) => {
    if (history.sitOutCount[b] !== history.sitOutCount[a]) {
      return history.sitOutCount[b] - history.sitOutCount[a]; // most sit-outs plays first
    }
    if (history.playCount[a] !== history.playCount[b]) {
      return history.playCount[a] - history.playCount[b]; // fewest rounds played plays first
    }
    return Math.random() - 0.5;
  });

  const poolSize = Math.min(maxPlayers, Math.floor(activeIds.length / 4) * 4);
  const playing = sorted.slice(0, poolSize);
  const sitOut = sorted.slice(poolSize);
  return { playing, sitOut };
}

function teamSplits4(four) {
  const [w, x, y, z] = four;
  return [
    [[w, x], [y, z]],
    [[w, y], [x, z]],
    [[w, z], [x, y]]
  ];
}

function combinations(arr, k) {
  const results = [];
  const combo = [];
  (function go(start) {
    if (combo.length === k) { results.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      go(i + 1);
      combo.pop();
    }
  })(0);
  return results;
}

/**
 * Given a pool of 4 or 8 players, find the court/team arrangement that minimises
 * repeated partnerships and repeated opponents, using a quadratic penalty so
 * repeats already seen twice are avoided harder than repeats seen once.
 */
function bestArrangement(pool, history) {
  const penalty = (a, b, type) => {
    const key = pairKey(a, b);
    const count = type === 'partner' ? (history.partner[key] || 0) : (history.opponent[key] || 0);
    return count * count;
  };

  const scoreCourt = (teamA, teamB) => {
    let s = penalty(teamA[0], teamA[1], 'partner') + penalty(teamB[0], teamB[1], 'partner');
    teamA.forEach(a => teamB.forEach(b => { s += penalty(a, b, 'opponent'); }));
    return s;
  };

  const bestSplitFor4 = (four) => {
    let best = null;
    teamSplits4(four).forEach(([teamA, teamB]) => {
      const s = scoreCourt(teamA, teamB);
      if (!best || s < best.score) best = { score: s, teamA, teamB };
    });
    return best;
  };

  if (pool.length === 4) {
    const best = bestSplitFor4(pool);
    return [{ teamA: best.teamA, teamB: best.teamB }];
  }

  // pool.length === 8: choose which 4 go on court 1 (rest go to court 2),
  // fixing pool[0] into the court-1 group to avoid double-counting mirrored splits.
  let best = null;
  const others = [1, 2, 3, 4, 5, 6, 7];
  combinations(others, 3).forEach(combo => {
    const court1Idx = new Set([0, ...combo]);
    const court1 = pool.filter((_, i) => court1Idx.has(i));
    const court2 = pool.filter((_, i) => !court1Idx.has(i));

    const bestC1 = bestSplitFor4(court1);
    const bestC2 = bestSplitFor4(court2);
    const total = bestC1.score + bestC2.score;

    if (!best || total < best.score) {
      best = {
        score: total,
        courts: [
          { teamA: bestC1.teamA, teamB: bestC1.teamB },
          { teamA: bestC2.teamA, teamB: bestC2.teamB }
        ]
      };
    }
  });
  return best.courts;
}

/**
 * Generate the next round.
 * @param {Array} players - all players currently in the tournament
 * @param {Array} existingRounds - rounds played so far
 * @param {number} courts - number of courts available (default 2)
 */
export function generateNextRound(players, existingRounds, courts = 2) {
  if (players.length < 4) {
    throw new Error('Need at least 4 players to generate a round.');
  }

  const history = buildHistory(players, existingRounds);
  const { playing, sitOut } = choosePlayingPool(players, history, courts);

  if (playing.length < 4) {
    throw new Error('Not enough players available to fill a court this round.');
  }

  const arrangement = bestArrangement(playing, history);

  const matches = arrangement.map((c, i) => ({
    court: i + 1,
    teamA: c.teamA,
    teamB: c.teamB,
    scoreA: null,
    scoreB: null,
    completed: false
  }));

  return {
    roundNumber: existingRounds.length + 1,
    sitOut,
    matches
  };
}

/**
 * Tally cumulative points, rounds played/won, and point differential per
 * player across all completed matches. "Won" means their team scored more
 * points than the opposing team in that round; equal scores count as
 * neither a win nor a loss.
 * Returns players sorted by total points desc, then point differential desc.
 */
export function computeStandings(players, rounds) {
  const totals = {};    // cumulative points scored
  const conceded = {};  // cumulative points scored against them
  const played = {};    // rounds played
  const won = {};        // rounds won

  players.forEach(p => {
    totals[p.id] = 0;
    conceded[p.id] = 0;
    played[p.id] = 0;
    won[p.id] = 0;
  });

  rounds.forEach(round => {
    round.matches.forEach(match => {
      if (!match.completed) return;
      const { teamA, teamB, scoreA, scoreB } = match;

      teamA.forEach(id => {
        totals[id] = (totals[id] || 0) + scoreA;
        conceded[id] = (conceded[id] || 0) + scoreB;
        played[id] = (played[id] || 0) + 1;
        if (scoreA > scoreB) won[id] = (won[id] || 0) + 1;
      });
      teamB.forEach(id => {
        totals[id] = (totals[id] || 0) + scoreB;
        conceded[id] = (conceded[id] || 0) + scoreA;
        played[id] = (played[id] || 0) + 1;
        if (scoreB > scoreA) won[id] = (won[id] || 0) + 1;
      });
    });
  });

  return players
    .map(p => ({
      id: p.id,
      name: p.name,
      points: totals[p.id] || 0,
      roundsPlayed: played[p.id] || 0,
      roundsWon: won[p.id] || 0,
      pointDiff: (totals[p.id] || 0) - (conceded[p.id] || 0)
    }))
    .sort((a, b) => b.points - a.points || b.pointDiff - a.pointDiff || a.name.localeCompare(b.name));
}

/**
 * The tournament's winner(s): every player tied for the highest points
 * total. Padel Americano/Mexicano rules define the winner purely by total
 * points, so ties on points are joint winners regardless of point
 * differential (which is only used to break ties in the ranked table).
 * Returns an empty array if no points have been recorded yet.
 */
export function getTournamentWinners(standings) {
  if (standings.length === 0) return [];
  const topPoints = standings[0].points;
  if (topPoints === 0) return [];
  return standings.filter(s => s.points === topPoints);
}

// ============================================================
// Social Play engine
// ============================================================
// A completely separate scheduling mode for casual, ongoing sessions
// (e.g. Sunday morning club tennis): no fixed player list, no scores,
// no partner-rotation requirement - just balanced, fair matches given
// whoever is currently checked in. Kept independent from the Americano
// functions above (rather than refactored to share code) so nothing here
// can affect tournament behaviour.
//
// player  = { id, name, rating: 1-5, gender?: 'M'|'F'|'', active: boolean }
// match   = { court, teamA: [id, id], teamB: [id, id] }  (no scores)
// round   = { roundNumber, sitOut: [id...], matches: [match...] }

/**
 * Choose which currently-checked-in players play this round, and which
 * sit out, prioritising whoever has sat out most / played fewest games so
 * far - so a late arrival is naturally prioritised into the next round,
 * and someone who has checked out simply stops being a candidate at all
 * (they are filtered out by the caller before this runs).
 */
function selectActivePlayers(candidateIds, history, courts) {
  const maxPlayers = courts * 4;

  const sorted = [...candidateIds].sort((a, b) => {
    const aSitOut = history.sitOutCount[a] || 0;
    const bSitOut = history.sitOutCount[b] || 0;
    if (bSitOut !== aSitOut) return bSitOut - aSitOut;
    const aPlayed = history.playCount[a] || 0;
    const bPlayed = history.playCount[b] || 0;
    if (aPlayed !== bPlayed) return aPlayed - bPlayed;
    return Math.random() - 0.5;
  });

  const poolSize = Math.min(maxPlayers, Math.floor(candidateIds.length / 4) * 4);
  return { playing: sorted.slice(0, poolSize), sitOut: sorted.slice(poolSize) };
}

function socialTeamSplits4(four) {
  const [w, x, y, z] = four;
  return [
    [[w, x], [y, z]],
    [[w, y], [x, z]],
    [[w, z], [x, y]]
  ];
}

function socialCombinations(arr, k) {
  const results = [];
  const combo = [];
  (function go(start) {
    if (combo.length === k) { results.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      go(i + 1);
      combo.pop();
    }
  })(0);
  return results;
}

/**
 * Score a candidate team split: lower is better. Dominated almost
 * entirely by skill balance (squared rating-average gap between the two
 * teams), with two much smaller nudges layered on top - a soft
 * preference for mixed-gender teams, and a light discouragement of
 * exact-repeat partnerships. Neither small nudge can outweigh a real
 * balance difference; they only break ties between similarly-balanced
 * options. `ratingById` here is whatever the caller passes in - it may
 * already be gender-adjusted (see generateNextSocialRound below); this
 * function doesn't need to know either way.
 */
function socialMatchPenalty(teamA, teamB, ratingById, genderById, history, preferMixedDoubles) {
  const avg = ids => (((ratingById[ids[0]] ?? 3) + (ratingById[ids[1]] ?? 3)) / 2);
  const diff = avg(teamA) - avg(teamB);
  let penalty = diff * diff * 100;

  if (preferMixedDoubles) {
    const sameGender = ids => {
      const g1 = genderById[ids[0]] || '';
      const g2 = genderById[ids[1]] || '';
      return g1 && g2 && g1 === g2;
    };
    if (sameGender(teamA)) penalty += 3;
    if (sameGender(teamB)) penalty += 3;
  }

  penalty += (history.partner[pairKey(teamA[0], teamA[1])] || 0) * 0.5;
  penalty += (history.partner[pairKey(teamB[0], teamB[1])] || 0) * 0.5;

  return penalty;
}

function bestSocialArrangement(pool, ratingById, genderById, history, preferMixedDoubles) {
  const bestSplitFor4 = (four) => {
    let best = null;
    socialTeamSplits4(four).forEach(([teamA, teamB]) => {
      const s = socialMatchPenalty(teamA, teamB, ratingById, genderById, history, preferMixedDoubles);
      if (!best || s < best.score) best = { score: s, teamA, teamB };
    });
    return best;
  };

  if (pool.length === 4) {
    const best = bestSplitFor4(pool);
    return [{ teamA: best.teamA, teamB: best.teamB }];
  }

  let best = null;
  const others = pool.slice(1).map((_, i) => i + 1);
  socialCombinations(others, 3).forEach(combo => {
    const court1Idx = new Set([0, ...combo]);
    const court1 = pool.filter((_, i) => court1Idx.has(i));
    const court2 = pool.filter((_, i) => !court1Idx.has(i));
    const bestC1 = bestSplitFor4(court1);
    const bestC2 = bestSplitFor4(court2);
    const total = bestC1.score + bestC2.score;
    if (!best || total < best.score) {
      best = {
        score: total,
        courts: [
          { teamA: bestC1.teamA, teamB: bestC1.teamB },
          { teamA: bestC2.teamA, teamB: bestC2.teamB }
        ]
      };
    }
  });
  return best.courts;
}

/**
 * Generate the next Social Play round from whoever is currently checked
 * in (player.active !== false). Throws if fewer than 4 are checked in.
 *
 * options.genderAdjustment (default 0): a men's and women's rating of the
 * same number aren't necessarily the same playing strength, so this
 * shifts men's ratings down and women's up by half this amount each,
 * purely for the balancing calculation - e.g. an adjustment of 1 means a
 * men's 5 and a women's 5 are treated as 1 full point apart. Only players
 * with gender 'M' or 'F' set are adjusted; unspecified gender is left as
 * entered. Raw ratings (as stored and displayed) are never changed.
 */
export function generateNextSocialRound(players, rounds, courts = 2, options = {}) {
  const preferMixedDoubles = !!options.preferMixedDoubles;
  const genderAdjustment = Number.isFinite(options.genderAdjustment) ? options.genderAdjustment : 0;
  const activeIds = players.filter(p => p.active !== false).map(p => p.id);

  if (activeIds.length < 4) {
    throw new Error('Need at least 4 checked-in players to generate a round.');
  }

  const history = buildHistory(players, rounds);
  const { playing, sitOut } = selectActivePlayers(activeIds, history, courts);

  if (playing.length < 4) {
    throw new Error('Not enough checked-in players to fill a court this round.');
  }

  const genderById = {};
  const effectiveRatingById = {};
  players.forEach(p => {
    const raw = p.rating ?? 3;
    genderById[p.id] = p.gender || '';
    if (genderAdjustment && p.gender === 'M') effectiveRatingById[p.id] = raw - genderAdjustment / 2;
    else if (genderAdjustment && p.gender === 'F') effectiveRatingById[p.id] = raw + genderAdjustment / 2;
    else effectiveRatingById[p.id] = raw;
  });

  const arrangement = bestSocialArrangement(playing, effectiveRatingById, genderById, history, preferMixedDoubles);

  const matches = arrangement.map((c, i) => ({ court: i + 1, teamA: c.teamA, teamB: c.teamB }));

  return { roundNumber: rounds.length + 1, sitOut, matches };
}

/**
 * Participation stats for a Social Play session: games played and times
 * sat out per player, sorted by fewest games played first (so the
 * organiser can see at a glance who's due a game next). No points or
 * rankings involved - this is purely a fairness check, not a leaderboard.
 */
export function computeSocialStats(players, rounds) {
  const history = buildHistory(players, rounds);
  return players
    .map(p => ({
      id: p.id,
      name: p.name,
      gamesPlayed: history.playCount[p.id] || 0,
      satOut: history.sitOutCount[p.id] || 0,
      active: p.active !== false
    }))
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed || a.name.localeCompare(b.name));
}
