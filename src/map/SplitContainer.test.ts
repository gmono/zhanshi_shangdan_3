// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SplitContainer } from './SplitContainer';

afterEach(cleanup);
function Example({ level, initial }: { level: 'outer' | 'inner'; initial: number[] }) {
  const [splits, setSplits] = useState(initial);
  return createElement(SplitContainer, { splits, interactive: true, label: '对比', level, onChange: setSplits,
    children: [createElement('div', { key: 0 }), createElement('div', { key: 1 }), createElement('div', { key: 2 })] });
}
for (const level of ['outer', 'inner'] as const) {
  it(`${level}分割线能贴边、重合并重新展开，不能交叉`, () => {
    const screen = render(createElement(Example, { level, initial: [0.08, 0.92] }));
    const [first, second] = screen.getAllByRole('slider');
    const current = () => JSON.parse(screen.container.firstElementChild!.getAttribute('data-splits')!) as number[];
    for (let i = 0; i < 10; i++) fireEvent.keyDown(first, { key: 'ArrowLeft' });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(second, { key: 'ArrowRight' });
    expect(current()).toEqual([0, 1]);
    expect(first.getAttribute('aria-valuemin')).toBe('0');
    expect(second.getAttribute('aria-valuemax')).toBe('100');
    for (let i = 0; i < 60; i++) fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(current()).toEqual([1, 1]);
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(current()).toEqual([0.98, 1]);
    for (let i = 0; i < 60; i++) fireEvent.keyDown(second, { key: 'ArrowLeft' });
    expect(current()).toEqual([0.98, 0.98]);
  });
}

it('仅内层可拖动分割线显示中部左右箭头，且不改变整线命中区', () => {
  const children = [0, 1, 2].map(index => createElement('div', { key: index }));
  const inner = render(createElement(SplitContainer, { splits: [0.4, 0.7], interactive: true, label: '对比', level: 'inner', onChange: () => undefined, children }));
  const arrows = inner.container.querySelectorAll('.divider-arrows');
  expect(arrows).toHaveLength(2);
  for (const group of arrows) {
    expect(group.getAttribute('aria-hidden')).toBe('true');
    expect(group.children).toHaveLength(0);
  }
  expect(inner.getAllByRole('slider')).toHaveLength(2);
  expect(inner.container.querySelectorAll('.divider-hit-area')).toHaveLength(2);
  expect(inner.container.querySelectorAll('.inner-divider')[0].getAttribute('data-arrow')).toBeNull();
  inner.unmount();

  const edges = render(createElement(SplitContainer, { splits: [0, 1], interactive: true, label: '对比', level: 'inner', onChange: () => undefined, children }));
  const dividers = edges.container.querySelectorAll('.inner-divider');
  expect(dividers[0].getAttribute('data-arrow')).toBe('start');
  expect(dividers[1].getAttribute('data-arrow')).toBe('end');
  edges.unmount();

  const near = render(createElement(SplitContainer, { splits: [0.01, 0.99], interactive: true, label: '对比', level: 'inner', onChange: () => undefined, children }));
  const nearDividers = near.container.querySelectorAll('.inner-divider');
  expect(nearDividers[0].getAttribute('data-arrow')).toBe('start');
  expect(nearDividers[1].getAttribute('data-arrow')).toBe('end');
  near.unmount();

  const outer = render(createElement(SplitContainer, { splits: [0.4, 0.7], interactive: true, label: '地点', level: 'outer', onChange: () => undefined, children }));
  expect(outer.container.querySelectorAll('.divider-arrows')).toHaveLength(0);
  outer.unmount();

  const passive = render(createElement(SplitContainer, { splits: [0.5], interactive: false, label: '对比', level: 'inner', onChange: () => undefined, children: children.slice(0, 2) }));
  expect(passive.container.querySelectorAll('.divider-arrows')).toHaveLength(0);
  expect(passive.queryAllByRole('slider')).toHaveLength(0);
});
