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
