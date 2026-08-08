require('dotenv').config();
const { pool } = require('../config/db');
const { hashPassword, isStrongPassword } = require('../utils/password');

async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || 'Platform Administrator';

  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env before seeding.');
  }
  if (!isStrongPassword(password)) {
    throw new Error('SEED_ADMIN_PASSWORD does not meet the strength policy (10+ chars, upper/lower/number/symbol).');
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) {
    console.log('ℹ️  Super admin already exists, skipping creation.');
  } else {
    const hash = await hashPassword(password);
    await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_active, must_change_password)
       VALUES ($1,$2,$3,'SUPER_ADMIN', true, true)`,
      [name, email, hash]
    );
    console.log(`✅ Super admin created: ${email}`);
    console.log('⚠️  This account must change its password on first login (must_change_password = true).');
  }

  // Optional: a couple of reference countries so the UI has data to show immediately.
  const countries = [
    { name: 'Germany', iso: 'DEU', fed: 'Deutscher Verband für Eisstocksport' },
    { name: 'Austria', iso: 'AUT', fed: 'Österreichischer Eisstocksportverband' },
    { name: 'Italy', iso: 'ITA', fed: 'Federazione Italiana Sport per Ghiaccio' },
    { name: 'India', iso: 'IND', fed: 'Icestock Federation of India' },
  ];
  for (const c of countries) {
    await pool.query(
      `INSERT INTO countries (name, iso_code, federation_name) VALUES ($1,$2,$3)
       ON CONFLICT (name) DO NOTHING`,
      [c.name, c.iso, c.fed]
    );
  }
  console.log('✅ Reference countries seeded (edit/remove freely from the admin panel).');

  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
