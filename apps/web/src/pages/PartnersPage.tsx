import { useState } from 'react';
import { motion } from 'framer-motion';
import { usePartnersList, useInvitePartner } from '@/hooks/usePartners';
import { useProposals } from '@/hooks/useSchedule';
import { useAuth } from '@/hooks/useAuth';
import { PartnerCard } from '@/components/partners/PartnerCard';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { EditorialHeading } from '@/components/ui/EditorialHeading';
import { useUiStore } from '@/stores/ui.store';

export function PartnersPage() {
  const partners = usePartnersList();
  const proposals = useProposals();
  const invite = useInvitePartner();
  const { person } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteData, setInviteData] = useState<{
    inviteUrl: string;
    token: string;
    expiresAt: string;
  } | null>(null);
  const showToast = useUiStore((s) => s.showToast);

  const list = partners.data ?? [];
  const satisfactionByPerson = (() => {
    const sat = proposals.data?.satisfaction ?? [];
    const me = person ? sat.find((s) => s.person_id === person.id) : null;
    return me?.per_partner ?? {};
  })();

  // Pre-compute next-block dates per partnership from proposals.
  const blocks = proposals.data?.proposals ?? [];
  const nextBlockByPartnership = new Map<string, string>();
  for (const b of blocks) {
    if (!b.partnershipId) continue;
    const existing = nextBlockByPartnership.get(b.partnershipId);
    if (!existing || b.startTime < existing) {
      nextBlockByPartnership.set(b.partnershipId, b.startTime);
    }
  }

  async function startInvite() {
    setInviteOpen(true);
    setInviteData(null);
    try {
      const result = await invite.mutateAsync();
      setInviteData(result);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not create invite',
        'error',
      );
      setInviteOpen(false);
    }
  }

  function copyLink() {
    if (!inviteData) return;
    navigator.clipboard
      .writeText(inviteData.inviteUrl)
      .then(() => showToast('Invite link copied', 'success'))
      .catch(() => showToast('Could not copy — try selecting manually', 'error'));
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="px-5 sm:px-8 py-6 sm:py-10 flex flex-col gap-8"
    >
      <header className="flex items-end justify-between gap-3">
        <EditorialHeading level={1} eyebrow="Partners">
          People you share time with
        </EditorialHeading>
        <Button onClick={startInvite}>Invite</Button>
      </header>

      {partners.isLoading ? (
        <p className="text-ink-500 text-sm italic">Loading…</p>
      ) : list.length === 0 ? (
        <EmptyState
          title="No partners yet"
          description="Invite your partner with a private link. Once they accept, you can both set preferences for time together."
          action={<Button onClick={startInvite}>Send your first invite</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((p, i) => {
            const stats = satisfactionByPerson[p.partner.id];
            const pct = stats?.pref_pct != null ? stats.pref_pct * 100 : undefined;
            const nextAt = nextBlockByPartnership.get(p.partnershipId);
            return (
              <motion.div
                key={p.partnershipId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.32 }}
              >
                <PartnerCard
                  partner={p}
                  satisfactionPct={pct}
                  nextBlockAt={nextAt}
                />
              </motion.div>
            );
          })}
        </div>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a partner"
        footer={
          inviteData && (
            <>
              <Button variant="ghost" onClick={() => setInviteOpen(false)}>
                Done
              </Button>
              <Button onClick={copyLink}>Copy link</Button>
            </>
          )
        }
      >
        {invite.isPending && (
          <p className="text-ink-500 italic text-sm">Generating link…</p>
        )}
        {inviteData && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-600 italic leading-relaxed">
              Share this link privately. It expires on{' '}
              <span className="font-mono not-italic text-ink-800">
                {new Date(inviteData.expiresAt).toLocaleDateString()}
              </span>
              .
            </p>
            <div className="bg-ink-50 border border-dashed border-ink-200 rounded-md px-3 py-3 text-sm break-all font-mono text-ink-700">
              {inviteData.inviteUrl}
            </div>
            <p className="text-xs text-ink-500 italic">
              Anyone with this link can connect to you. Don't post it publicly.
            </p>
          </div>
        )}
      </Modal>
    </motion.div>
  );
}
