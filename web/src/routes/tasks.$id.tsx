import { useParams, Link, useNavigate } from 'react-router';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTask, useContent, useReveal, useMediaInfo, useHighlights, useAddHighlight, useDeleteHighlight, useNotes } from '@/hooks/use-tasks';
import { Reader } from '@/components/reader';
import { Toc, extractToc } from '@/components/toc';
import { SubtitleList } from '@/components/subtitle-list';
import { Player } from '@/components/player';
import { NotesPanel } from '@/components/notes-panel';
import { ModeSwitcher } from '@/components/mode-switcher';
import { ProseThemePicker } from '@/components/prose-theme-picker';
import { CommentViewToggle } from '@/components/comment-view-toggle';
import { InlineCards, UnlocatedZone } from '@/components/inline-notes';
import { VoiceBar, VoiceToast } from '@/components/voice-bar';
import { useVoiceComments } from '@/hooks/use-voice-comments';
import { useUiStore } from '@/stores/ui-store';
import type { LayoutMode } from '@/stores/ui-store';
import { usePlayerStore } from '@/stores/player-store';
import { useMarkRead, useMarkUnread } from '@/hooks/use-read-state';
import type { NoteAnchor } from '@/lib/api';
import type { Located } from '@/lib/anchor';
import { stripScMarkers } from '@/lib/sc-marker';

function sameLocated(a: Record<string, Located>, b: Record<string, Located>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => b[k] && a[k].start === b[k].start && a[k].end === b[k].end && a[k].grade === b[k].grade);
}

// Keyed by id: a task switch remounts the page, so no state (voice recording/pending cards included)
// renders for one frame against the new task before its effect cleanups run.
export default function TaskDetail() {
  const { id = '' } = useParams();
  return <TaskDetailPage key={id} />;
}

function TaskDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const isArticleTask = id.startsWith('article-');
  const goBack = () => {
    if (window.history.state?.idx > 0) {
      navigate(-1);
    } else {
      navigate(isArticleTask ? '/articles' : '/videos');
    }
  };
  const { data: task, isLoading } = useTask(id);
  const { data: mediaInfo } = useMediaInfo(id);
  const mediaKind: 'video' | 'audio' | null =
    mediaInfo?.video?.exists ? 'video' :
    mediaInfo?.audio?.exists ? 'audio' : null;
  const [tab, setTab] = useState<'summary' | 'article'>(isArticleTask ? 'article' : 'summary');
  const { data: content = '' } = useContent(id, tab);
  const toc = useMemo(() => extractToc(stripScMarkers(content)), [content]);
  const reveal = useReveal();
  const { data: highlights = [] } = useHighlights(id);
  const addHighlight = useAddHighlight(id);
  const deleteHighlight = useDeleteHighlight(id);

  const layoutMode = useUiStore((s) => s.layoutMode);
  const setLayoutMode = useUiStore((s) => s.setLayoutMode);
  const [ccEnabled, setCcEnabled] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<NoteAnchor | null>(null);
  const [located, setLocated] = useState<Record<string, Located>>({});
  const onNotesLocated = useCallback((next: Record<string, Located>) => {
    setLocated((prev) => (sameLocated(prev, next) ? prev : next));
  }, []);
  const { data: notes = [] } = useNotes(id);
  const voice = useVoiceComments(id, isArticleTask);
  // Reader also marks the anchors of voice comments still in flight (`voice:` processing cards, `voice-rec:` the
  // live recording); everything else on the page (cards' notes, unlocated zone, collapse-all) uses the real notes.
  const readerNotes = useMemo(() => [
    ...notes,
    ...voice.pending.map((p) => ({ id: p.id, ...p.anchor })),
    ...(voice.recording ? [{ id: `voice-rec:${voice.recording.id}`, ...voice.recording.anchor }] : []),
  ], [notes, voice.pending, voice.recording]);
  const voiceCancelRef = useRef(voice.cancel);
  useEffect(() => { voiceCancelRef.current = voice.cancel; });
  const cancelVoice = useCallback(() => voiceCancelRef.current(), []);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const commentView = useUiStore((s) => s.commentView);
  const inline = commentView === 'inline';
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = useCallback((noteId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(noteId)) next.add(noteId);
      return next;
    });
  }, []);
  const allCollapsed = notes.every((n) => collapsed.has(n.id));
  // Voice pseudo-note marks have no card to collapse or open for editing.
  const onNoteAnchorClick = useCallback((noteId: string) => {
    if (noteId.startsWith('voice:') || noteId.startsWith('voice-rec:')) return;
    if (inline) toggleCollapsed(noteId); else setFocusNoteId(noteId);
  }, [inline, toggleCollapsed]);
  const articleRef = useRef<HTMLDivElement>(null);
  const resetPlayer = usePlayerStore((s) => s.reset);
  const markRead = useMarkRead();
  const markUnread = useMarkUnread();

  // Reset player state when switching tasks so stale playing/time don't bleed over
  useEffect(() => { resetPlayer(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a task marks it read
  useEffect(() => { if (id) markRead.mutate(id); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-set default mode based on mediaKind (once per task load)
  useEffect(() => {
    if (!mediaInfo) return;
    const defaultMode: LayoutMode =
      mediaKind === 'video' ? 'A' :
      mediaKind === 'audio' ? 'C' : 'E';
    setLayoutMode(defaultMode);
  }, [mediaInfo, mediaKind, setLayoutMode]);

  // Sync data-mode attribute on shell element
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    shell.setAttribute('data-mode', layoutMode);
  }, [layoutMode]);

  const onCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(stripScMarkers(content));
  };

  const onReveal = () => reveal.mutate(id);

  if (isLoading) return <div className="p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>;
  if (!task) return <div className="p-8 text-sm" style={{ color: 'var(--status-err)' }}>未找到任务</div>;

  return (
    <div className="h-screen flex flex-col relative">
      {/* Header */}
      <header className="h-12 flex items-center justify-between px-5 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-4 min-w-0">
          <button type="button" onClick={goBack} className="text-sm" style={{ color: 'var(--text-tertiary)' }}>←</button>
          <h1 className="chinese text-sm font-medium truncate">{task.title || task.url}</h1>
        </div>
        <div className="flex items-center gap-3">
          <ProseThemePicker />
          <CommentViewToggle />
          {mediaKind && <ModeSwitcher />}
          {task.uploader_id && (
            <Link
              to={`/creator/${task.uploader_id.replace(/^@/, '').toLowerCase()}`}
              title={`查看${task.uploader ? ` ${task.uploader} ` : ''}的其他视频`}
              className="text-sm px-2 py-1 rounded hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {task.uploader ?? '创作者'}
            </Link>
          )}
          {mediaKind && (
            <Link
              to={`/tasks/${id}/gantt`}
              title="执行甘特图"
              className="text-sm px-2 py-1 rounded hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-tertiary)' }}
            >
              ▦
            </Link>
          )}
          <button type="button" onClick={() => markUnread.mutate(id)} style={{ color: 'var(--text-tertiary)' }}
                  className="text-sm hover:text-[var(--text-secondary)] cursor-pointer">标记为未读</button>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)' }}>⌘K</kbd>
          </div>
        </div>
      </header>

      {/* Layout shell — data-mode drives all CSS */}
      <div
        ref={shellRef}
        data-mode={layoutMode}
        className="layout-shell flex-1 flex flex-col min-h-0"
      >
        {/* MODE C: top audio bar — works for both audio and video tasks */}
        <div className="audio-bar" style={{ display: layoutMode === 'C' ? undefined : 'none' }}>
          {layoutMode === 'C' && mediaKind && (
            <Player taskId={id} kind={mediaKind} audioOnly={true} />
          )}
        </div>

        {/* Main content area */}
        <div className="mode-content">

          {/* MODE C body wrapper (subtitle col + article) */}
          <div className="mode-content-body">

            {/* LEFT PANEL — Mode A: video + notes below */}
            <section className="panel-left">
              {layoutMode === 'A' && mediaKind && (
                <Player
                  taskId={id}
                  kind={mediaKind}
                  audioOnly={mediaKind === 'audio'}
                  showCc={true}
                  ccEnabled={ccEnabled}
                  onToggleCc={() => setCcEnabled((v) => !v)}
                />
              )}
              <div className="left-notes flex-1 overflow-y-auto">
                <NotesPanel taskId={id} hasMedia={!!mediaKind} />
              </div>
            </section>

            {/* MODE C: subtitle column */}
            <aside className="subtitle-col">
              <SubtitleList taskId={id} />
            </aside>

            {/* RIGHT PANEL — article + tab bar */}
            <section className="panel-right">
              {/* Tab bar */}
              <div className="px-12 border-b flex items-center justify-between flex-shrink-0"
                   style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex">
                  {!isArticleTask && (['summary', 'article'] as const).map((t) => (
                    <button key={t} onClick={() => { if (t !== tab) { setTab(t); setDraft(null); } }}
                            className="py-2.5 mr-6 text-sm border-b-2 transition-colors cursor-pointer"
                            style={{
                              borderColor: tab === t ? 'var(--accent-9)' : 'transparent',
                              color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                              fontWeight: tab === t ? 500 : 400
                            }}>
                      {t === 'summary' ? '总结' : '文章'}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 py-3 text-xs">
                  {inline && notes.length > 0 && (
                    <button onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(notes.map((n) => n.id)))}
                            style={{ color: 'var(--text-tertiary)' }}
                            className="hover:text-[var(--text-secondary)] cursor-pointer">
                      {allCollapsed ? '全部展开' : '全部收起'}
                    </button>
                  )}
                  <button onClick={onCopy} style={{ color: 'var(--text-tertiary)' }}
                          className="hover:text-[var(--text-secondary)] cursor-pointer">复制</button>
                  <button onClick={onReveal} style={{ color: 'var(--text-tertiary)' }}
                          className="hover:text-[var(--text-secondary)] cursor-pointer">显示文件</button>
                </div>
              </div>

              {/* Article + Notes row (B/C/E/F modes) */}
              <div className="flex-1 overflow-y-auto">
                {voice.recording && (
                  <VoiceBar
                    startedAt={voice.recording.startedAt}
                    anchor={voice.recording.anchor}
                    showHint={voice.showHint}
                    onStop={voice.stop}
                    onCancel={cancelVoice}
                    onDismissHint={voice.dismissHint}
                  />
                )}
                <div className="article-notes-row">
                  <div className="article-col" ref={articleRef}>
                    {inline && (
                      <UnlocatedZone
                        taskId={id}
                        hasMedia={!!mediaKind}
                        notes={notes.filter((n) => !located[n.id])}
                        collapsed={collapsed}
                        onToggle={toggleCollapsed}
                        hoveredNoteId={hoveredNoteId}
                        onHover={setHoveredNoteId}
                      />
                    )}
                    <Reader
                      taskId={id}
                      content={content}
                      frontmatter={tab === 'article' ? task.frontmatter : undefined}
                      highlights={highlights}
                      doc={isArticleTask ? undefined : tab}
                      notes={readerNotes}
                      onNotesLocated={onNotesLocated}
                      draft={inline ? draft : undefined}
                      renderInline={inline ? (ids) => (
                        <InlineCards
                          taskId={id}
                          hasMedia={!!mediaKind}
                          ids={ids}
                          notes={notes}
                          located={located}
                          draft={draft}
                          onDraftDone={() => setDraft(null)}
                          collapsed={collapsed}
                          onToggle={toggleCollapsed}
                          hoveredNoteId={hoveredNoteId}
                          onHover={setHoveredNoteId}
                          voicePending={voice.pending}
                          onVoiceRetry={voice.retry}
                          onVoiceDiscard={voice.discard}
                          flashNoteId={voice.justSavedId}
                        />
                      ) : undefined}
                      onCommentDraft={layoutMode === 'A' && !inline ? undefined : setDraft}
                      onAddHighlight={(anchor, color) => addHighlight.mutate({ anchor, color })}
                      onDeleteHighlight={(hlId) => deleteHighlight.mutate(hlId)}
                      hoveredNoteId={hoveredNoteId}
                      onNoteHover={setHoveredNoteId}
                      onNoteAnchorClick={onNoteAnchorClick}
                      voice={isArticleTask ? {
                        state: voice.available === false ? 'unavailable' : voice.busy ? 'recording' : 'ready',
                        onStart: voice.start,
                        onStop: voice.stop,
                        onUnavailable: voice.notifyUnavailable,
                      } : undefined}
                    />
                  </div>
                  <Toc items={toc} />
                  {!inline && (
                    <aside className="notes-col">
                      <NotesPanel
                        taskId={id}
                        hasMedia={!!mediaKind}
                        pendingAnchor={draft}
                        onAnchorConsumed={() => setDraft(null)}
                        articleRef={articleRef}
                        located={located}
                        hoveredNoteId={hoveredNoteId}
                        onNoteHover={setHoveredNoteId}
                        focusNoteId={focusNoteId}
                        onFocusConsumed={() => setFocusNoteId(null)}
                        voicePending={voice.pending}
                        onVoiceRetry={voice.retry}
                        onVoiceDiscard={voice.discard}
                        flashNoteId={voice.justSavedId}
                      />
                    </aside>
                  )}
                </div>
              </div>
            </section>

            {/* MODE B: right sidebar (video + subtitles) */}
            <aside className="panel-sidebar">
              {layoutMode === 'B' && mediaKind && (
                <Player taskId={id} kind={mediaKind} audioOnly={mediaKind === 'audio'} />
              )}
              <div className="flex-1 overflow-hidden">
                <SubtitleList taskId={id} />
              </div>
            </aside>

          </div>{/* end mode-content-body */}

          {/* MODE F: theater — full-width media above */}
          <div className="theater-section">
            {layoutMode === 'F' && mediaKind === 'video' && (
              <div className="relative bg-black w-full" style={{ maxHeight: '58vh', aspectRatio: '16/9' }}>
                <Player
                  taskId={id}
                  kind="video"
                  showCc={true}
                  ccEnabled={ccEnabled}
                  onToggleCc={() => setCcEnabled((v) => !v)}
                  className="w-full h-full"
                />
              </div>
            )}
            {layoutMode === 'F' && mediaKind === 'audio' && (
              <div className="flex items-center px-5" style={{ height: 72 }}>
                <Player taskId={id} kind="audio" audioOnly={true} />
              </div>
            )}
          </div>

        </div>{/* end mode-content */}
      </div>
      {voice.toast && <VoiceToast text={voice.toast} />}
    </div>
  );
}
