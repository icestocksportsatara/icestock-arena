/**
 * ============================================================================
 * ICESTOCK SCORING ENGINE
 * ============================================================================
 * Implements the point systems for the 6 requested event types, based on the
 * International Federation Icestocksport (IFI) official disciplines:
 *   https://www.icestock.sport/en/disciplines/
 *   https://www.icestock.sport/en/ifi/rules/
 *
 * Every numeric rule below is exposed through `format_config` on the
 * tournament_events row so a SUPER_ADMIN can tune it from the official IFI
 * rulebook PDF without touching code (IFI updates rules periodically, most
 * recently the head-to-head target format). Defaults here mirror the
 * publicly documented rules at the time of writing.
 * ============================================================================
 */

const DEFAULT_CONFIG = {
  TEAM_GAME: {
    turns: 6,
    maxPointsPerTurn: 4, // 4 icestocks per team per turn, 1 pt each if closer than opponent's best
    gamePointsForWin: 2,
    gamePointsForDraw: 1,
  },
  TEAM_TARGET: {
    rounds: 4,
    attemptsPerRound: 6,
    ringPoints: [2, 4, 6, 8, 10], // outside -> center, round 1
    // Rounds 2-4: scenario-based scoring (team-play situations)
    scenarioPoints: { OWN_STAYS_OPP_OUT: 10, BOTH_OUT: 5, BOTH_STAY: 2, MISS: 0 },
    maxPerRound: 60,
    maxTotal: 240,
  },
  INDIVIDUAL_TARGET: {
    rounds: 4,
    attemptsPerRound: 6,
    ringPoints: [2, 4, 6, 8, 10],
    scenarioPoints: { OWN_STAYS_OPP_OUT: 10, BOTH_OUT: 5, BOTH_STAY: 2, MISS: 0 },
    maxPerRound: 60,
    maxTotal: 240,
  },
  TEAM_DISTANCE: {
    attempts: 6,
    // Distance zone bands (meters) -> points. Tune to the current official
    // rulebook / venue lane length before a sanctioned event.
    distanceZones: [
      { minM: 0, maxM: 20, points: 1 },
      { minM: 20, maxM: 30, points: 2 },
      { minM: 30, maxM: 40, points: 3 },
      { minM: 40, maxM: 50, points: 4 },
      { minM: 50, maxM: 9999, points: 5 },
    ],
  },
  INDIVIDUAL_DISTANCE: {
    attempts: 6,
    distanceZones: [
      { minM: 0, maxM: 20, points: 1 },
      { minM: 20, maxM: 30, points: 2 },
      { minM: 30, maxM: 40, points: 3 },
      { minM: 40, maxM: 50, points: 4 },
      { minM: 50, maxM: 9999, points: 5 },
    ],
  },
  HEAD_TO_HEAD: {
    attemptsPerRound: 4, // alternating between the two athletes
    gamePointsToWin: 7,
    tieBreak: 'TOTAL_RAW_SCORE',
  },
};

function getConfig(eventType, format_config) {
  return { ...DEFAULT_CONFIG[eventType], ...(format_config || {}) };
}

/* ---------------------------------------------------------------------- */
/* 1. TEAM GAME                                                            */
/* ---------------------------------------------------------------------- */
function computeTeamGame(turns, format_config) {
  const cfg = getConfig('TEAM_GAME', format_config);
  let teamAStockTotal = 0;
  let teamBStockTotal = 0;
  for (const t of turns) {
    teamAStockTotal += t.team_a_points;
    teamBStockTotal += t.team_b_points;
  }
  let teamAGamePoints = 0;
  let teamBGamePoints = 0;
  if (teamAStockTotal > teamBStockTotal) teamAGamePoints = cfg.gamePointsForWin;
  else if (teamBStockTotal > teamAStockTotal) teamBGamePoints = cfg.gamePointsForWin;
  else {
    teamAGamePoints = cfg.gamePointsForDraw;
    teamBGamePoints = cfg.gamePointsForDraw;
  }
  const winner =
    teamAGamePoints > teamBGamePoints ? 'TEAM_A' : teamBGamePoints > teamAGamePoints ? 'TEAM_B' : 'DRAW';

  return {
    turnsPlayed: turns.length,
    teamAStockTotal,
    teamBStockTotal,
    teamAGamePoints,
    teamBGamePoints,
    winner,
  };
}

/* ---------------------------------------------------------------------- */
/* 2. TEAM_TARGET / INDIVIDUAL_TARGET (shared logic)                       */
/* ---------------------------------------------------------------------- */
function computeTargetCompetition(attempts, eventType, format_config) {
  const cfg = getConfig(eventType, format_config);
  const byParticipant = {};

  for (const a of attempts) {
    const key = a.participant_team_id || a.participant_player_id;
    if (!byParticipant[key]) byParticipant[key] = { rounds: {}, total: 0 };
    byParticipant[key].rounds[a.round_number] = byParticipant[key].rounds[a.round_number] || [];
    byParticipant[key].rounds[a.round_number].push(a.points_scored);
    byParticipant[key].total += a.points_scored;
  }

  const leaderboard = Object.entries(byParticipant)
    .map(([participantId, data]) => {
      const roundTotals = {};
      for (const [round, scores] of Object.entries(data.rounds)) {
        roundTotals[round] = scores.reduce((s, v) => s + v, 0);
      }
      return { participantId, roundTotals, total: data.total, maxPossible: cfg.maxTotal };
    })
    .sort((a, b) => b.total - a.total)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  return { config: cfg, leaderboard };
}

/* ---------------------------------------------------------------------- */
/* 3. TEAM_DISTANCE / INDIVIDUAL_DISTANCE (shared logic)                   */
/* ---------------------------------------------------------------------- */
function pointsForDistance(distanceM, zones) {
  const zone = zones.find((z) => distanceM >= z.minM && distanceM < z.maxM);
  return zone ? zone.points : 0;
}

function computeDistanceCompetition(attempts, eventType, format_config) {
  const cfg = getConfig(eventType, format_config);
  const byParticipant = {};

  for (const a of attempts) {
    const key = a.participant_team_id || a.participant_player_id;
    if (!byParticipant[key]) byParticipant[key] = { attempts: [], total: 0, bestM: 0 };
    const pts = a.is_fault ? 0 : pointsForDistance(Number(a.distance_m), cfg.distanceZones);
    byParticipant[key].attempts.push({ distanceM: Number(a.distance_m), points: pts, fault: a.is_fault });
    byParticipant[key].total += pts;
    byParticipant[key].bestM = Math.max(byParticipant[key].bestM, a.is_fault ? 0 : Number(a.distance_m));
  }

  const leaderboard = Object.entries(byParticipant)
    .map(([participantId, data]) => ({ participantId, ...data }))
    .sort((a, b) => b.total - a.total || b.bestM - a.bestM)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  return { config: cfg, leaderboard };
}

/* ---------------------------------------------------------------------- */
/* 4. HEAD_TO_HEAD                                                         */
/* ---------------------------------------------------------------------- */
function computeHeadToHead(rounds, format_config) {
  const cfg = getConfig('HEAD_TO_HEAD', format_config);
  let aGamePoints = 0;
  let bGamePoints = 0;
  let aRawTotal = 0;
  let bRawTotal = 0;
  let winner = null;
  let decidingRound = null;

  const sorted = [...rounds].sort((x, y) => x.round_number - y.round_number);

  for (const r of sorted) {
    aGamePoints += r.player_a_round_points;
    bGamePoints += r.player_b_round_points;
    aRawTotal += r.player_a_raw_score;
    bRawTotal += r.player_b_raw_score;

    if (!winner && aGamePoints >= cfg.gamePointsToWin && aGamePoints > bGamePoints) {
      winner = 'PLAYER_A';
      decidingRound = r.round_number;
    } else if (!winner && bGamePoints >= cfg.gamePointsToWin && bGamePoints > aGamePoints) {
      winner = 'PLAYER_B';
      decidingRound = r.round_number;
    }
  }

  if (!winner && aGamePoints === bGamePoints) {
    winner = aRawTotal > bRawTotal ? 'PLAYER_A' : bRawTotal > aRawTotal ? 'PLAYER_B' : 'DRAW';
  }

  return {
    roundsPlayed: sorted.length,
    aGamePoints,
    bGamePoints,
    aRawTotal,
    bRawTotal,
    winner,
    decidingRound,
    gamePointsToWin: cfg.gamePointsToWin,
  };
}

/* ---------------------------------------------------------------------- */
/* Dispatcher used by controllers                                          */
/* ---------------------------------------------------------------------- */
function computeResult(eventType, rawData, format_config) {
  switch (eventType) {
    case 'TEAM_GAME':
      return computeTeamGame(rawData, format_config);
    case 'TEAM_TARGET':
    case 'INDIVIDUAL_TARGET':
      return computeTargetCompetition(rawData, eventType, format_config);
    case 'TEAM_DISTANCE':
    case 'INDIVIDUAL_DISTANCE':
      return computeDistanceCompetition(rawData, eventType, format_config);
    case 'HEAD_TO_HEAD':
      return computeHeadToHead(rawData, format_config);
    default:
      throw new Error(`Unknown event type: ${eventType}`);
  }
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig,
  computeTeamGame,
  computeTargetCompetition,
  computeDistanceCompetition,
  computeHeadToHead,
  computeResult,
};
