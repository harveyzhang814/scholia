import type { Root } from 'mdast';

// Invisible `<!-- sc:<id> -->` / `<!-- /sc:<id> -->` comments that Scholia writes into source files.
export const SC_MARKER_RE = /^<!--\s*(\/?)sc:([0-9a-f]{8})\s*-->$/;
const SC_MARKER_GLOBAL_RE = /<!--\s*\/?sc:[0-9a-f]{8}\s*-->/g;

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: unknown;
}

function walk(node: Node) {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const m = child.type === 'html' && child.value ? SC_MARKER_RE.exec(child.value) : null;
    if (m) {
      // A custom node type with data.hName makes mdast-util-to-hast emit an empty <span>.
      children[i] = {
        type: 'scMarker',
        data: { hName: 'span', hProperties: { dataScUi: '', dataScMarker: m[2], dataScEdge: m[1] ? 'close' : 'open' } },
        children: [],
      };
    } else {
      walk(child);
    }
  }
}

// Remark plugin: turn sc marker html nodes (inline or block) into empty spans; other html is untouched.
export function remarkScMarkers() {
  return (tree: Root) => walk(tree as unknown as Node);
}

export function stripScMarkers(md: string): string {
  return md.replace(SC_MARKER_GLOBAL_RE, '');
}
