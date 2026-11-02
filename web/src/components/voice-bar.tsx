import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/time';
import { anchorKind } from '@/lib/anchor';
import type { NoteAnchor } from '@/lib/api';
import { isTypingTarget } from '@/components/reader';

const ANCHOR_PREVIEW = 40;

export function VoiceBar({ startedAt, anchor, showHint, onStop, onCancel, onDismissHint }: {
  startedAt: number;
  anchor: NoteAnchor;
  showHint: boolean;
  onStop: () => void;
  onCancel: () => void;
  onDismissHint: () => void;
}) {
  const elapsed = () => Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const [seconds, setSeconds] = useState(elapsed);

  useEffect(() => {
    setSeconds(elapsed());
    const timer = setInterval(() => setSeconds(elapsed()), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Esc inside a field means "leave the field", not "cancel the recording".
      if (e.key === 'Escape' && !(e.target instanceof HTMLElement && isTypingTarget(e.target))) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const label = anchorKind(anchor) === 'range' ? Array.from(anchor.anchor).slice(0, ANCHOR_PREVIEW).join('') : '插入点';

  return (
    <div className="voice-bar" role="status">
      <div className="voice-bar-row">
        <span className="voice-dot" />
        <span className="voice-label">录音中</span>
        <span className="voice-timer">{formatDuration(seconds)}</span>
        <span className="voice-sep">·</span>
        <span className="voice-anchor">评论「{label}」</span>
        <span className="voice-actions">
          <button onClick={onStop}>结束并保存 <kbd className="kbd">v</kbd></button>
          <button onClick={onCancel}>取消 <kbd className="kbd">Esc</kbd></button>
        </span>
      </div>
      {showHint && (
        <div className="voice-hint">
          <span>
            第一次用语音评论：请在 CocoScribe 设置里关掉 <strong>「转录完成后弹出编辑窗口」</strong> 和 <strong>「Copy transcript to clipboard」</strong>，否则每条语音评论结束后 CocoScribe 都会弹出自己的窗口、并覆盖你的剪贴板。Scholia 读不到 CocoScribe 的设置，这条提示只出现一次。
          </span>
          <button onClick={onDismissHint}>知道了</button>
        </div>
      )}
    </div>
  );
}

export function VoiceToast({ text }: { text: string }) {
  return <div className="voice-toast" role="status">{text}</div>;
}
