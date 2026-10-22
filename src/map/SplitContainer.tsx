import { useRef, type ReactNode } from 'react';
import { IonIcon } from '@ionic/react';
import { reorderThreeOutline } from 'ionicons/icons';

interface Props {
  splits: number[];
  interactive: boolean;
  label: string;
  level: 'outer' | 'inner';
  children: ReactNode[];
  onChange: (splits: number[]) => void;
}

export function SplitContainer({ splits, interactive, label, level, children, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; index: number } | null>(null);
  const edges = [0, ...splits, 1];
  const move = (index: number, value: number) => {
    const next = [...splits];
    next[index] = Math.max(edges[index] + 0.08, Math.min(value, edges[index + 2] - 0.08));
    onChange(next);
  };
  const movePointer = (pointer: number, clientX: number) => {
    if (!root.current || drag.current?.pointer !== pointer) return;
    const box = root.current.getBoundingClientRect();
    if (box.width > 0) move(drag.current.index, (clientX - box.left) / box.width);
  };
  return <div ref={root} className={`split-container split-${level}`} data-splits={JSON.stringify(splits)}>
    {children.map((child, index) => <div key={index} className="split-panel" style={level === 'outer'
      ? { left: `${edges[index] * 100}%`, width: `${(edges[index + 1] - edges[index]) * 100}%` }
      : { inset: 0, clipPath: `inset(0 ${(1 - edges[index + 1]) * 100}% 0 ${edges[index] * 100}%)` }}>
      {child}
    </div>)}
    {splits.map((split, index) => <div key={index} className={`divider ${level}-divider`} style={{ left: `${split * 100}%` }}>
      {interactive && <div className="divider-grip" role="slider" tabIndex={0} aria-label={`${label}分割线 ${index + 1}`}
        aria-valuenow={split * 100} aria-valuemin={edges[index] * 100 + 8} aria-valuemax={edges[index + 2] * 100 - 8} aria-orientation="horizontal"
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); drag.current = { pointer: event.pointerId, index }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { movePointer(event.pointerId, event.clientX); }}
        onPointerUp={event => { movePointer(event.pointerId, event.clientX); drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(index, split + (event.key === 'ArrowLeft' ? -0.02 : 0.02)); } }}>
        <IonIcon icon={reorderThreeOutline} />
      </div>}
    </div>)}
  </div>;
}
