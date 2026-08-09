/**
 * Role hierarchy reference (highest to lowest authority):
 *   SUPER_ADMIN   -> full access to everything (single platform owner)
 *   COUNTRY_HEAD  -> registration for their country only (all states/districts within)
 *   STATE_HEAD    -> registration for their state only
 *   DISTRICT_HEAD -> registration for their district only
 *   REFEREE       -> scoring & scorecards for matches they're assigned to
 *   PLAYER        -> read-only stats + practice mode
 */

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

/**
 * Ensures a registration-tier user (COUNTRY/STATE/DISTRICT_HEAD) can only
 * act within their own geographic scope. SUPER_ADMIN bypasses this check.
 * Expects the target scope IDs on req.body or req.resourceScope
 * (set by the controller after loading the target record).
 */
function enforceGeoScope(req, res, next) {
  const { role, country_id, state_id, district_id } = req.user;
  if (role === 'SUPER_ADMIN') return next();

  const target = req.resourceScope || req.body;

  if (role === 'COUNTRY_HEAD') {
    if (target.country_id && target.country_id !== country_id) {
      return res.status(403).json({ error: 'Outside your country scope.' });
    }
  } else if (role === 'STATE_HEAD') {
    if (target.state_id && target.state_id !== state_id) {
      return res.status(403).json({ error: 'Outside your state scope.' });
    }
  } else if (role === 'DISTRICT_HEAD') {
    if (target.district_id && target.district_id !== district_id) {
      return res.status(403).json({ error: 'Outside your district scope.' });
    }
  } else {
    return res.status(403).json({ error: 'Role not permitted for registration actions.' });
  }
  next();
}

/**
 * Gates tournament-scoped registration actions. Only SUPER_ADMIN or a head
 * account that the admin has explicitly assigned (via tournament_registrars)
 * to THIS SPECIFIC tournament may register/enter participants into it —
 * being a Country/State/District Head does not by itself grant access.
 * Expects :tournamentId in the route params.
 */
function requireTournamentRegistrar() {
  const { query } = require('../config/db');
  return async (req, res, next) => {
    try {
      if (req.user.role === 'SUPER_ADMIN') return next();
      const tournamentId = req.params.tournamentId || req.body.tournamentId;
      if (!tournamentId) return res.status(400).json({ error: 'tournamentId is required.' });

      const { rows } = await query(
        'SELECT 1 FROM tournament_registrars WHERE tournament_id = $1 AND user_id = $2',
        [tournamentId, req.user.id]
      );
      if (!rows.length) {
        return res.status(403).json({
          error: 'You have not been assigned by the admin to register participants for this tournament.',
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireRole, enforceGeoScope, requireTournamentRegistrar };
