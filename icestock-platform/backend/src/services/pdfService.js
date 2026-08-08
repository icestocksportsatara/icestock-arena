const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_DIR = process.env.LOCAL_STORAGE_PATH || './storage';
const SCORECARD_DIR = path.join(STORAGE_DIR, 'scorecards');

function ensureDir() {
  fs.mkdirSync(SCORECARD_DIR, { recursive: true });
}

const BRAND = {
  ink: '#0B1B2B',
  ice: '#5FD3F3',
  frost: '#EAF6FB',
  accent: '#FF7A45',
  gray: '#6B7A8D',
};

/**
 * Renders a professional scorecard PDF for a completed match and returns
 * { filePath, fileHash }. Layout: header with tournament identity, event
 * type + rules reference, participant names, the round/turn breakdown table,
 * final result, and referee sign-off with a verification hash + QR-style
 * reference code (printed as text; wire up `qrcode` package for a real QR).
 */
async function generateScorecard({ match, tournament, event, participants, rawEntries, referee }) {
  ensureDir();
  const fileName = `scorecard_${match.id}.pdf`;
  const filePath = path.join(SCORECARD_DIR, fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Header band
  doc.rect(0, 0, doc.page.width, 90).fill(BRAND.ink);
  doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold').text('ICESTOCK SPORT — OFFICIAL SCORECARD', 40, 25);
  doc.fontSize(10).font('Helvetica').fillColor(BRAND.ice).text(
    'International Federation Icestocksport (IFI) Rules', 40, 52
  );
  doc.fillColor('#FFFFFF').fontSize(9).text(`Generated: ${new Date().toISOString()}`, 40, 68);

  doc.moveDown(4);
  doc.fillColor(BRAND.ink).fontSize(14).font('Helvetica-Bold').text(tournament.name, 40, 105);
  doc.fontSize(10).font('Helvetica').fillColor(BRAND.gray).text(
    `${tournament.level} · ${tournament.venue || 'Venue TBD'} · ${tournament.start_date} — ${tournament.end_date}`
  );

  doc.moveDown(1);
  doc.fontSize(12).font('Helvetica-Bold').fillColor(BRAND.ink).text(`Event: ${event.event_type.replace(/_/g, ' ')} (${event.category})`);
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica').fillColor(BRAND.gray).text(`Round: ${match.round_name || '-'}   Lane: ${match.venue_lane || '-'}`);

  doc.moveDown(1);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND.ink).text('Participants');
  doc.font('Helvetica').fontSize(10).fillColor(BRAND.ink);
  doc.text(`A: ${participants.aName}`);
  doc.text(`B: ${participants.bName}`);

  doc.moveDown(1);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND.ink).text('Scoring Breakdown');
  doc.moveDown(0.3);

  // Simple table rendering
  const tableTop = doc.y;
  let y = tableTop;
  doc.fontSize(9).font('Helvetica-Bold');
  const columns = getColumns(event.event_type);
  const colWidth = (doc.page.width - 80) / columns.length;
  columns.forEach((c, i) => doc.text(c, 40 + i * colWidth, y, { width: colWidth }));
  y += 16;
  doc.moveTo(40, y - 4).lineTo(doc.page.width - 40, y - 4).strokeColor(BRAND.gray).stroke();

  doc.font('Helvetica').fontSize(9);
  for (const row of formatRows(event.event_type, rawEntries)) {
    if (y > doc.page.height - 100) {
      doc.addPage();
      y = 40;
    }
    row.forEach((val, i) => doc.text(String(val), 40 + i * colWidth, y, { width: colWidth }));
    y += 14;
  }

  doc.moveDown(2);
  doc.fontSize(12).font('Helvetica-Bold').fillColor(BRAND.accent).text('Final Result', 40, y + 20);
  doc.fontSize(10).font('Helvetica').fillColor(BRAND.ink).text(JSON.stringify(match.result, null, 2), { width: doc.page.width - 80 });

  doc.moveDown(2);
  doc.fontSize(9).fillColor(BRAND.gray).text(`Officiated by: ${referee?.full_name || 'Unassigned'}`);
  doc.text(`Match ID: ${match.id}`);

  const integrityHash = crypto.createHash('sha256').update(JSON.stringify({ match: match.id, result: match.result })).digest('hex');
  doc.text(`Verification hash: ${integrityHash}`);
  doc.fontSize(8).fillColor(BRAND.gray).text(
    'This scorecard is system-generated from referee-submitted, timestamped scoring entries and cannot be edited after finalization.',
    { width: doc.page.width - 80 }
  );

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { filePath, fileHash: integrityHash };
}

function getColumns(eventType) {
  switch (eventType) {
    case 'TEAM_GAME': return ['Turn', 'Team A pts', 'Team B pts'];
    case 'TEAM_TARGET':
    case 'INDIVIDUAL_TARGET': return ['Round', 'Attempt', 'Participant', 'Points'];
    case 'TEAM_DISTANCE':
    case 'INDIVIDUAL_DISTANCE': return ['Attempt', 'Participant', 'Distance (m)', 'Zone pts', 'Fault'];
    case 'HEAD_TO_HEAD': return ['Round', 'A round pts', 'B round pts', 'A raw', 'B raw'];
    default: return ['Data'];
  }
}

function formatRows(eventType, rawEntries) {
  switch (eventType) {
    case 'TEAM_GAME':
      return rawEntries.map((r) => [r.turn_number, r.team_a_points, r.team_b_points]);
    case 'TEAM_TARGET':
    case 'INDIVIDUAL_TARGET':
      return rawEntries.map((r) => [r.round_number, r.attempt_number, r.participant_team_id || r.participant_player_id, r.points_scored]);
    case 'TEAM_DISTANCE':
    case 'INDIVIDUAL_DISTANCE':
      return rawEntries.map((r) => [r.attempt_number, r.participant_team_id || r.participant_player_id, r.distance_m, r.zone_points, r.is_fault ? 'Y' : 'N']);
    case 'HEAD_TO_HEAD':
      return rawEntries.map((r) => [r.round_number, r.player_a_round_points, r.player_b_round_points, r.player_a_raw_score, r.player_b_raw_score]);
    default:
      return [];
  }
}

module.exports = { generateScorecard, SCORECARD_DIR };
