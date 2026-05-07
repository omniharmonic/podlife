import { useState } from 'react';
import type { TimeBlock as TimeBlockType } from '@pod-life/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { useRespondToProposal } from '@/hooks/useSchedule';
import { useUiStore } from '@/stores/ui.store';
import { formatDayShort, formatTimeRange, parseISO } from '@/lib/dates';

interface TimeBlockDetailModalProps {
  block: TimeBlockType | null;
  onClose: () => void;
  contextLabel?: string;
  color?: string;
}

export function TimeBlockDetailModal({
  block,
  onClose,
  contextLabel,
  color,
}: TimeBlockDetailModalProps) {
  const [changeNote, setChangeNote] = useState('');
  const [showChangeForm, setShowChangeForm] = useState(false);
  const respond = useRespondToProposal();
  const showToast = useUiStore((s) => s.showToast);

  if (!block) return null;

  const isProposed = block.status === 'proposed';
  const start = parseISO(block.startTime);
  const end = parseISO(block.endTime);

  async function handleRespond(
    response: 'accepted' | 'declined' | 'change_requested',
  ) {
    if (!block) return;
    try {
      await respond.mutateAsync({
        blockId: block.id,
        response,
        changeNote: response === 'change_requested' ? changeNote : undefined,
      });
      const verb =
        response === 'accepted'
          ? 'Accepted'
          : response === 'declined'
            ? 'Declined'
            : 'Change requested';
      showToast(`${verb} — your partner will be notified`, 'success');
      onClose();
      setShowChangeForm(false);
      setChangeNote('');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not submit response',
        'error',
      );
    }
  }

  return (
    <Modal open onClose={onClose} title={block.eventLabel ?? block.eventType}>
      <div className="flex flex-col gap-4">
        <div
          className="rounded-2xl px-4 py-3 text-white"
          style={{ backgroundColor: color ?? '#81B29A' }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold opacity-95">
              {block.eventType}
            </span>
            <Badge
              tone={
                block.status === 'proposed'
                  ? 'proposed'
                  : block.status === 'accepted'
                    ? 'accepted'
                    : block.status === 'locked'
                      ? 'locked'
                      : 'neutral'
              }
              className="bg-white/20 text-white border-white/30"
            >
              {block.status}
            </Badge>
          </div>
          <div className="font-bold text-lg leading-tight">
            {formatDayShort(start)}
          </div>
          <div className="text-sm opacity-95">{formatTimeRange(start, end)}</div>
        </div>

        {contextLabel && (
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500 font-semibold mb-1">
              With
            </p>
            <p className="text-stone-800 font-semibold">{contextLabel}</p>
          </div>
        )}

        {isProposed && !showChangeForm && (
          <div className="text-sm text-stone-600 bg-stone-50 rounded-2xl p-3">
            This is a proposal. Accept it to lock it in, request a change, or
            decline.
          </div>
        )}

        {showChangeForm && (
          <Input
            label="What would work better?"
            placeholder="e.g., later in the evening, or Saturday instead"
            value={changeNote}
            onChange={(e) => setChangeNote(e.currentTarget.value)}
            hint="Your partner sees this as a free-form suggestion."
          />
        )}

        {isProposed && (
          <div className="flex flex-col gap-2 pt-2">
            {!showChangeForm ? (
              <>
                <Button
                  fullWidth
                  variant="primary"
                  loading={respond.isPending}
                  onClick={() => handleRespond('accepted')}
                >
                  Accept
                </Button>
                <Button
                  fullWidth
                  variant="secondary"
                  onClick={() => setShowChangeForm(true)}
                  disabled={respond.isPending}
                >
                  Suggest a change
                </Button>
                <Button
                  fullWidth
                  variant="ghost"
                  onClick={() => handleRespond('declined')}
                  disabled={respond.isPending}
                >
                  Decline
                </Button>
              </>
            ) : (
              <>
                <Button
                  fullWidth
                  variant="primary"
                  loading={respond.isPending}
                  onClick={() => handleRespond('change_requested')}
                  disabled={!changeNote.trim()}
                >
                  Send suggestion
                </Button>
                <Button
                  fullWidth
                  variant="ghost"
                  onClick={() => setShowChangeForm(false)}
                  disabled={respond.isPending}
                >
                  Back
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
