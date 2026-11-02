import { formatDuration } from '@/lib/time';
import { anchorKind } from '@/lib/anchor';
import type { VoicePending } from '@/hooks/use-voice-comments';
import type { CardVariant } from './note-card';

export function voiceFailureCopy(code: string, canRetry: boolean): { reason: string; hint: string } {
  switch (code) {
    case 'no_audio':
      return { reason: '没有录到声音', hint: '检查麦克风后重新录一段' };
    case 'empty':
      return { reason: '没有识别出文字', hint: '重新录一段试试' };
    case 'connection_lost':
    case 'transport':
    case 'app_not_running':
    case 'unavailable':
      return { reason: 'CocoScribe 连接中断', hint: '' };
    case 'save_failed':
      return { reason: '保存失败', hint: '文字已整理好，但没能写入评论文件' };
    default:
      return { reason: '转写或整理失败', hint: canRetry ? '录音还在 CocoScribe 里，重试不用重录' : '' };
  }
}

function MicIcon() {
  return (
    <svg className="sc-voice-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function VoicePendingCard({ item, variant, onRetry, onDiscard }: {
  item: VoicePending;
  variant: CardVariant;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const kind = anchorKind(item.anchor);
  const failed = item.phase === 'failed';
  const failure = item.failure;
  const copy = failed ? voiceFailureCopy(failure?.code ?? '', !!failure?.canRetry) : null;

  return (
    <div className="sc-note-card" data-variant={variant} data-voice-state={item.phase}>
      {variant === 'sidebar' && kind !== 'none' && (
        <div className="sc-quote" data-quote>
          {kind === 'range' ? item.anchor.anchor.split('\n')[0] : '插入点'}
        </div>
      )}
      {copy ? (
        <div className="sc-voice-state is-failed">
          <div className="sc-voice-reason"><MicIcon /><span>{copy.reason}</span></div>
          <div className="sc-card-meta">
            <span>{copy.hint}</span>
            <span className="sc-voice-actions">
              {failure?.canRetry && failure.taskId && (
                <button data-voice-act="retry" onClick={onRetry}>重试</button>
              )}
              <button data-voice-act="discard" onClick={onDiscard}>丢弃</button>
            </span>
          </div>
        </div>
      ) : (
        <div className="sc-voice-state is-processing">
          <MicIcon />
          <span className="sc-voice-steps">
            {item.phase === 'transcribing' ? <><b>转写中…</b> → 整理</> : <>转写 → <b>整理中…</b></>}
          </span>
          <span className="sc-voice-spin" />
          <span className="sc-voice-dur">{formatDuration(item.durationSec)}</span>
        </div>
      )}
    </div>
  );
}
