import { describe, expect, it } from 'vitest';
import { clickMotionObject } from './motion-selection';
describe('normal clicks choose the motion pair', () => {
  it('selects source then destination in order', () => {
    const first = clickMotionObject(undefined, undefined, 'first');
    expect(first).toEqual({sourceId:'first',destinationId:undefined});
    expect(clickMotionObject(first.sourceId,first.destinationId,'second')).toEqual({sourceId:'first',destinationId:'second'});
  });
  it('clicking the first again clears it both before and after the second is selected', () => {
    expect(clickMotionObject('first',undefined,'first')).toEqual({sourceId:undefined,destinationId:undefined});
    expect(clickMotionObject('first','second','first')).toEqual({sourceId:undefined,destinationId:undefined});
  });
  it('allows changing or deselecting the destination without changing the source', () => {
    expect(clickMotionObject('first','second','third')).toEqual({sourceId:'first',destinationId:'third'});
    expect(clickMotionObject('first','second','second')).toEqual({sourceId:'first',destinationId:undefined});
  });
  it('keeps the pair when clicking empty space', () => {
    expect(clickMotionObject('first','second',undefined)).toEqual({sourceId:'first',destinationId:'second'});
  });
});
