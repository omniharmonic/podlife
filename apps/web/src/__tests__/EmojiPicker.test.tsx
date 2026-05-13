import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EmojiPicker } from '@/components/ui/EmojiPicker';

/**
 * The full @emoji-mart/react Picker renders a complex DOM tree that doesn't
 * always play nicely with jsdom — clicking inside it requires the picker's
 * internal handlers to fire. To keep the test focused on *our* contract
 * (open/close behavior + onChange wiring), we mock the Picker with a stub
 * that exposes a single button calling onEmojiSelect when clicked.
 */
vi.mock('@emoji-mart/react', () => {
  return {
    __esModule: true,
    default: (props: {
      onEmojiSelect: (e: { native: string }) => void;
    }) => (
      <button
        type="button"
        data-testid="mock-picker-pick"
        onClick={() => props.onEmojiSelect({ native: '🦊' })}
      >
        Pick fox
      </button>
    ),
  };
});

vi.mock('@emoji-mart/data', () => ({ __esModule: true, default: {} }));

describe('<EmojiPicker />', () => {
  it('renders the current emoji on the trigger button', () => {
    render(<EmojiPicker value="🌻" onChange={() => {}} />);
    expect(screen.getByLabelText('Choose emoji')).toHaveTextContent('🌻');
  });

  it('renders an optional label', () => {
    render(<EmojiPicker value="🌻" onChange={() => {}} label="Pod emoji" />);
    expect(screen.getByText('Pod emoji')).toBeInTheDocument();
  });

  it('opens the picker on trigger click and closes after a selection', () => {
    const onChange = vi.fn();
    render(<EmojiPicker value="🌻" onChange={onChange} />);

    // Picker is not visible yet.
    expect(screen.queryByTestId('mock-picker-pick')).not.toBeInTheDocument();

    // Click the trigger.
    fireEvent.click(screen.getByLabelText('Choose emoji'));
    expect(screen.getByTestId('mock-picker-pick')).toBeInTheDocument();

    // Pick an emoji.
    fireEvent.click(screen.getByTestId('mock-picker-pick'));
    expect(onChange).toHaveBeenCalledWith('🦊');
    // Picker closes after pick.
    expect(screen.queryByTestId('mock-picker-pick')).not.toBeInTheDocument();
  });

  it('toggles closed when the trigger is clicked twice', () => {
    render(<EmojiPicker value="🌻" onChange={() => {}} />);
    const trigger = screen.getByLabelText('Choose emoji');
    fireEvent.click(trigger);
    expect(screen.getByTestId('mock-picker-pick')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByTestId('mock-picker-pick')).not.toBeInTheDocument();
  });

  it('closes on outside click', () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <EmojiPicker value="🌻" onChange={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByLabelText('Choose emoji'));
    expect(screen.getByTestId('mock-picker-pick')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('mock-picker-pick')).not.toBeInTheDocument();
  });
});
