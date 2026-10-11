import { describe, it, expect } from 'vitest';
import { parseMotionAdjustment, motionAdjustmentRequest } from './motion-adjustment';
const answer = (score=2,choice='keep')=>({answers:{timing:{type:'score',score},interpolation:{type:'choice',choice}}});
describe('Jev corrections',()=>{
  it('normalizes structured timing decisions and accepts explicit seconds',()=>{
    expect(parseMotionAdjustment(answer(4,'bezier'),{instruction:'più lento',durationSeconds:2})).toEqual({durationSeconds:4,interpolation:'bezier'});
    expect(parseMotionAdjustment(answer(0),{instruction:'durata 3,5 secondi',durationSeconds:2}).durationSeconds).toBe(3.5);
    expect(parseMotionAdjustment(answer(),{instruction:'fluido',durationSeconds:2}).durationSeconds).toBe(2);
  });
  it('rejects non-finite, out-of-range and unexpected service answers',()=>{
    for (const value of [answer(8),answer(NaN),answer(2,'create'),{}]) expect(()=>parseMotionAdjustment(value,{instruction:'più lento',durationSeconds:2})).toThrow();
    expect(()=>parseMotionAdjustment(answer(),{instruction:'durata 9000 s',durationSeconds:2})).toThrow();
  });
  it('requests only timing changes, without scene creation',()=>{
    const request=motionAdjustmentRequest({instruction:'più lento',durationSeconds:2});
    expect(Object.keys(request.questions)).toEqual(['timing','interpolation']);
    expect(request.questions.timing.instructions).toContain('Preserve its drawn curve');
  });
});
