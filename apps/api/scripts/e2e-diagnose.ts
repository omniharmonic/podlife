/**
 * Re-runs the Hearth pod cycle in isolation and dumps every proposed
 * block + every overlap so we can see what the no-double-booking
 * constraint is allowing through.
 */
import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
loadDotenv({ path: resolve(__dirname, '../../../.env') });

import { eq, inArray } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import {
  persons,
  pods,
  podMembers,
  schedulingCycles,
  timeBlocks,
  timeBlockParticipants,
} from '../src/db/schema.js';
import { processCycleJob, triggerCycle } from '../src/modules/schedule/cycle.manager.js';

async function main(): Promise<void> {
  const [hearth] = await db.select().from(pods).where(eq(pods.name, 'Hearth')).limit(1);
  if (!hearth) throw new Error('Hearth pod missing — run e2e:stress first to seed');
  const members = await db
    .select()
    .from(podMembers)
    .where(eq(podMembers.podId, hearth.id));
  const triggererId = members[0]!.personId;

  const { cycleId } = await triggerCycle({
    personId: triggererId,
    podId: hearth.id,
    triggerType: 'manual',
  });
  await processCycleJob({ cycleId });

  const blocks = await db
    .select()
    .from(timeBlocks)
    .where(eq(timeBlocks.cycleId, cycleId));
  const allParts = await db
    .select()
    .from(timeBlockParticipants)
    .where(inArray(timeBlockParticipants.timeBlockId, blocks.map((b) => b.id)));
  const personRows = await db
    .select()
    .from(persons)
    .where(inArray(persons.id, members.map((m) => m.personId)));
  const nameById = new Map(personRows.map((p) => [p.id, p.displayName]));

  const partsByBlock = new Map<string, string[]>();
  for (const p of allParts) {
    const arr = partsByBlock.get(p.timeBlockId) ?? [];
    arr.push(p.personId);
    partsByBlock.set(p.timeBlockId, arr);
  }

  console.log(`\n=== Hearth cycle ${cycleId} — ${blocks.length} blocks ===`);
  blocks.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  for (const b of blocks) {
    const ppl = (partsByBlock.get(b.id) ?? []).map((id) => nameById.get(id) ?? id).join(', ');
    console.log(
      `  ${b.startTime.toISOString().slice(5, 16)} → ${b.endTime.toISOString().slice(11, 16)}  ` +
        `[${b.eventType.padEnd(15)}] ${ppl}`,
    );
  }

  console.log(`\n=== Overlaps with shared participants ===`);
  let overlaps = 0;
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (a.endTime <= b.startTime || b.endTime <= a.startTime) continue;
      const aP = new Set(partsByBlock.get(a.id) ?? []);
      const bP = partsByBlock.get(b.id) ?? [];
      const shared = bP.filter((p) => aP.has(p)).map((id) => nameById.get(id) ?? id);
      if (shared.length === 0) continue;
      overlaps++;
      console.log(
        `  ${a.startTime.toISOString().slice(5, 16)}+${a.eventType.slice(0, 8)} ↔ ` +
          `${b.startTime.toISOString().slice(5, 16)}+${b.eventType.slice(0, 8)} ` +
          `share: ${shared.join(', ')}`,
      );
    }
  }
  console.log(`Total: ${overlaps} overlap pairs`);

  // Cleanup the cycle so re-runs are clean.
  await db.delete(timeBlockParticipants).where(inArray(timeBlockParticipants.timeBlockId, blocks.map((b) => b.id)));
  await db.delete(timeBlocks).where(eq(timeBlocks.cycleId, cycleId));
  await db.delete(schedulingCycles).where(eq(schedulingCycles.id, cycleId));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
