import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { primitiveGeometry, usePrimitiveMaterial } from './PrimitiveMesh';

describe('shared viewport GPU resources', () => {
  it('shares geometry without changing the size or subdivision of primitives', () => {
    expect(primitiveGeometry('sphere')).toBe(primitiveGeometry('sphere'));
    primitiveGeometry('cube').computeBoundingBox();
    expect(primitiveGeometry('cube').boundingBox?.min.toArray()).toEqual([-1,-1,-1]);
    expect(primitiveGeometry('cube').boundingBox?.max.toArray()).toEqual([1,1,1]);
  });
  it('keeps shared materials alive until the last consumer unmounts, including StrictMode', async () => {
    const wrapper = ({children}:{children:ReactNode}) => <StrictMode>{children}</StrictMode>;
    const first = renderHook(()=>usePrimitiveMaterial('#112233'),{wrapper});
    const second = renderHook(()=>usePrimitiveMaterial('#112233'),{wrapper});
    const material = first.result.current; let disposals = 0;
    material.addEventListener('dispose', ()=>{disposals++;});
    expect(second.result.current).toBe(material);
    first.unmount(); await act(async()=>{await Promise.resolve();}); expect(disposals).toBe(0);
    second.unmount(); await act(async()=>{await Promise.resolve();}); expect(disposals).toBe(1);
  });
});
