import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { NoteItem } from './notes-panel';
import type { Note } from '@/lib/api';

describe('NoteItem isLinked/editing interaction', () => {
  beforeEach(() => {
    // Mock ResizeObserver for tests
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;

    // Mock scrollIntoView on HTMLElement
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it('suppresses isLinked background highlight when editing is active', () => {
    const note: Note = {
      id: 'test-note-1',
      anchor: 'test anchor text',
      body: 'This is a test note',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const { container } = render(
      <NoteItem
        note={note}
        onUpdate={() => {}}
        onDelete={() => {}}
        onHeightChange={() => {}}
        isLinked={true}
        onHover={() => {}}
        autoEdit={true}
        onAutoEditConsumed={() => {}}
      />
    );

    const li = container.querySelector('li');
    expect(li).toBeTruthy();

    // When editing is active (triggered by autoEdit={true}), the background
    // should not show the isLinked highlight, even though isLinked={true}
    const style = li?.getAttribute('style') || '';
    // The style should not contain the accent-3 background color when editing
    expect(style).not.toContain('var(--accent-3)');

    // Confirm that a textarea is present (edit mode is active)
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
  });
});
