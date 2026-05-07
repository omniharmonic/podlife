/**
 * Mint a session token for an existing person (admin/E2E utility).
 *
 *   pnpm tsx scripts/mint-session.ts <email>
 *
 * Reads DATABASE_URL from env. Hashes a fresh random secret with the same
 * bcrypt routine the API uses (apps/api/src/lib/hash.ts), inserts a sessions
 * row, and prints the bearer token in the format the API expects:
 *   <sessionId>.<rawSecret>
 *
 * Use this only for testing — don't bake into prod flows. The token gives
 * full account access for SESSION_TTL_DAYS.
 */
import postgres from 'postgres';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

const email = process.argv[2];
if (!email) {
  console.error('Usage: pnpm tsx scripts/mint-session.ts <email>');
  process.exit(1);
}

async function main(): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false, ssl: 'require' });
  try {
    const personRows = await sql<{ id: string; display_name: string }[]>`
      select id, display_name from persons where email = ${email} limit 1
    `;
    if (personRows.length === 0) {
      console.error(`No person with email ${email}`);
      process.exit(2);
    }
    const personId = personRows[0]!.id;

    const rawSecret = nanoid(48);
    // Match apps/api/src/lib/hash.ts — bcrypt rounds = 10.
    const tokenHash = await bcrypt.hash(rawSecret, 10);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const inserted = await sql<{ id: string }[]>`
      insert into sessions (person_id, token_hash, expires_at)
      values (${personId}, ${tokenHash}, ${expiresAt})
      returning id
    `;
    const sessionId = inserted[0]!.id;
    const sessionToken = `${sessionId}.${rawSecret}`;

    // eslint-disable-next-line no-console
    console.log(sessionToken);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
