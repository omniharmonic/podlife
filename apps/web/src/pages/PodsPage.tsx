import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { usePodsList, useCreatePod } from '@/hooks/usePods';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { EditorialHeading } from '@/components/ui/EditorialHeading';
import { useUiStore } from '@/stores/ui.store';

const POD_EMOJIS = ['🏠', '🌳', '🌻', '🪴', '🍃', '🌿', '🌞', '🌙', '✨', '🔥'];

/**
 * Pods list. When the user has exactly one pod we redirect to its detail
 * page — the list view is only meaningful with multiple pods. The "Add a
 * pod" CTA lives on Settings when count ≤ 1; this page only shows "New
 * pod" once there's already a list to add to.
 */
export function PodsPage() {
  const list = usePodsList();
  const create = useCreatePod();
  const showToast = useUiStore((s) => s.showToast);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🏠');
  const [memberEmails, setMemberEmails] = useState('');

  const pods = list.data ?? [];

  // Single-pod users always go straight to that pod. The "Add a pod" CTA
  // lives on Settings, so the list view only matters with 2+ pods.
  if (!list.isLoading && pods.length === 1) {
    return <Navigate to={`/pods/${pods[0]!.id}`} replace />;
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        emoji,
        memberEmails: memberEmails
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      showToast(`Pod "${name.trim()}" created`, 'success');
      setOpen(false);
      setName('');
      setEmoji('🏠');
      setMemberEmails('');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not create pod',
        'error',
      );
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="px-5 sm:px-8 py-6 sm:py-8 flex flex-col gap-7"
    >
      <header className="flex items-end justify-between gap-3">
        <EditorialHeading level={1} eyebrow="Your pods">
          Pods
        </EditorialHeading>
        {pods.length > 0 && (
          <Button onClick={() => setOpen(true)}>New pod</Button>
        )}
      </header>

      {list.isLoading ? (
        <p className="text-ink-500 text-sm">Loading…</p>
      ) : pods.length === 0 ? (
        <EmptyState
          title="No pods yet"
          description="A pod is a named group — your nesting partners, a co-living crew, a chosen family. Create one to schedule shared time."
          action={<Button onClick={() => setOpen(true)}>Create your first pod</Button>}
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {pods.map((pod, i) => (
            <motion.div
              key={pod.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
            >
              <Link
                to={`/pods/${pod.id}`}
                className="block focus:outline-none focus-visible:ring-1 focus-visible:ring-ink rounded-2xl"
              >
                <article className="relative bg-cream border border-ink-100/70 rounded-2xl shadow-paper p-5 hover:shadow-letter hover:-translate-y-0.5 transition-all flex items-center gap-4">
                  <div
                    aria-hidden="true"
                    className="w-14 h-14 shrink-0 rounded-2xl bg-parchment border border-ink-100/60 flex items-center justify-center text-2xl"
                  >
                    {pod.emoji ?? '🏠'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-ink-800 text-2xl leading-tight tracking-[-0.005em] truncate">
                      {pod.name}
                    </h3>
                    <p className="text-sm text-ink-500 truncate mt-0.5">
                      {pod.description ?? `${cadenceShort(pod.schedulingCadence)} check-ins`}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-ink-300 text-2xl font-display leading-none"
                  >
                    →
                  </span>
                </article>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a pod"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={onCreate}
              loading={create.isPending}
              disabled={!name.trim()}
            >
              Create
            </Button>
          </>
        }
      >
        <form onSubmit={onCreate} className="flex flex-col gap-6">
          <Input
            label="Pod name"
            placeholder="e.g., Home Base"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
          />
          <div>
            <span className="eyebrow text-ink-500 mb-2 block">Emoji</span>
            <div className="flex flex-wrap gap-2">
              {POD_EMOJIS.map((e) => (
                <button
                  type="button"
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl border transition-all ${
                    emoji === e
                      ? 'bg-terracotta-50 border-terracotta-500 scale-105'
                      : 'bg-cream border-ink-100 hover:bg-ink-50'
                  }`}
                  aria-label={`Choose emoji ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <Input
            label="Invite members (optional)"
            placeholder="email@example.com, another@example.com"
            value={memberEmails}
            onChange={(e) => setMemberEmails(e.currentTarget.value)}
            hint="Separate emails with commas. They'll receive an invitation."
          />
        </form>
      </Modal>
    </motion.div>
  );
}

function cadenceShort(c: string): string {
  if (c === 'biweekly') return 'Biweekly';
  if (c === 'monthly') return 'Monthly';
  return 'Weekly';
}
