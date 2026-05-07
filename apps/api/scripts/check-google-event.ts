/**
 * Diagnostic: query Google Calendar for an event by id using the stored
 * encrypted refresh token for a person. Prints the event payload (or 404).
 *
 *   pnpm exec tsx scripts/check-google-event.ts <person-email> <event-id>
 */
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is required');

const email = process.argv[2];
const eventId = process.argv[3];
if (!email || !eventId) {
  console.error('Usage: tsx scripts/check-google-event.ts <email> <eventId>');
  process.exit(1);
}

async function main(): Promise<void> {
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false, ssl: 'require' });
  try {
    // Fetch the connection row directly. We re-implement the decryption inline
    // rather than importing from the API tree to keep this script standalone.
    const rows = await sql<{
      encrypted_refresh_token: Buffer | null;
    }[]>`
      select cc.encrypted_refresh_token
      from calendar_connections cc
      join persons p on p.id = cc.person_id
      where p.email = ${email} and cc.provider = 'google'
      limit 1
    `;
    if (rows.length === 0 || !rows[0]?.encrypted_refresh_token) {
      console.error('No Google connection / refresh token for', email);
      process.exit(2);
    }
    // Decrypt refresh token (AES-256-GCM, format: iv(12) || ciphertext || tag(16))
    const { createDecipheriv } = await import('node:crypto');
    const blob = rows[0].encrypted_refresh_token;
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(blob.length - 16);
    const ct = blob.subarray(12, blob.length - 16);
    const key = Buffer.from(ENCRYPTION_KEY!, 'hex');
    const dec = createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const refreshToken = Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');

    // Refresh-grant for a fresh access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tok = (await tokenRes.json()) as { access_token: string; error?: string };
    if (!tok.access_token) {
      console.error('refresh failed:', tok);
      process.exit(3);
    }

    // GET the event
    const evRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { headers: { authorization: `Bearer ${tok.access_token}` } },
    );
    const body = await evRes.text();
    console.log('HTTP', evRes.status);
    try {
      const parsed = JSON.parse(body);
      console.log('event status:', parsed.status, 'summary:', parsed.summary);
    } catch {
      console.log(body.slice(0, 400));
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
