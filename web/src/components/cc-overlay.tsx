import { usePlayerStore } from '@/stores/player-store';
import { useUiStore } from '@/stores/ui-store';

interface CcOverlayProps {
  enabled: boolean;
}

export function CcOverlay({ enabled }: CcOverlayProps) {
  const subtitles = usePlayerStore((s) => s.subtitles);
  const activeIndex = usePlayerStore((s) => s.activeIndex);
  const subtitleScale = useUiStore((s) => s.subtitleScale);

  if (!enabled || activeIndex < 0) return null;
  const text = subtitles[activeIndex]?.text;
  if (!text) return null;

  return (
    <div className="cc-overlay-text" style={{ '--cc-scale': subtitleScale } as React.CSSProperties}>
      {text}
    </div>
  );
}
