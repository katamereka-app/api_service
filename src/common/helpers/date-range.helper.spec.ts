import { resolveRange } from './date-range.helper.js';
import { BadRequestException } from '@nestjs/common';

describe('resolveRange', () => {
  it('should return all nulls when range is all or empty', () => {
    const resNull = resolveRange(null);
    expect(resNull.key).toBe('all');
    expect(resNull.from).toBeNull();
    expect(resNull.to).toBeNull();
    expect(resNull.prevFrom).toBeNull();

    const resAll = resolveRange('all');
    expect(resAll.key).toBe('all');
    expect(resAll.from).toBeNull();
  });

  it('should calculate 30d correctly in WIB', () => {
    const ref = new Date('2026-10-02T10:00:00.000Z');
    const res = resolveRange('30d', ref);

    expect(res.key).toBe('30d');
    expect(res.from).not.toBeNull();
    expect(res.to).not.toBeNull();
    expect(res.prevFrom).not.toBeNull();
    expect(res.prevTo).not.toBeNull();
  });

  it('should throw BadRequestException for invalid range', () => {
    expect(() => resolveRange('invalid_range')).toThrow(BadRequestException);
  });
});
