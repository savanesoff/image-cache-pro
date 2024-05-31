import { Memory } from './memory';
import { UNITS } from '@utils';

describe('Memory', () => {
  describe('initial state', () => {
    let memory: Memory;
    let state: ReturnType<typeof Memory.prototype.getState>;
    const size = 10;
    const units = 'BYTE';

    beforeEach(() => {
      memory = new Memory({ size, units });
      state = memory.getState();
    });

    it('should have correct size', () => {
      expect(state.size).toBe(size);
    });

    it('should have correct units', () => {
      expect(state.units).toBe(units);
    });

    it('should have correct bytes size', () => {
      expect(state.sizeBytes).toBe(size * UNITS[units]);
    });

    it('should have correct count', () => {
      expect(state.count).toBe(0);
    });
  });

  describe('initial free space', () => {
    let memory: Memory;
    let freeSpace: ReturnType<typeof Memory.prototype.getFreeSpace>;
    const size = 10;
    const units = 'GB';

    beforeEach(() => {
      memory = new Memory({ size, units });
      freeSpace = memory.getFreeSpace();
    });

    it('should have correct bytes', () => {
      expect(freeSpace.bytes).toBe(size * UNITS[units]);
    });

    it('should have correct units', () => {
      expect(freeSpace.units).toBe(size);
    });

    it('should have correct percentage', () => {
      expect(freeSpace.prs).toBe(100);
    });
  });

  describe('initial used space', () => {
    let memory: Memory;
    let usedSpace: ReturnType<typeof Memory.prototype.getUsedSpace>;
    const size = 10;
    const units = 'MB';

    beforeEach(() => {
      memory = new Memory({ size, units });
      usedSpace = memory.getUsedSpace();
    });

    it('should have correct bytes', () => {
      expect(usedSpace.bytes).toBe(0);
    });

    it('should have correct units', () => {
      expect(usedSpace.units).toBe(0);
    });

    it('should have correct percentage', () => {
      expect(usedSpace.prs).toBe(0);
    });
  });

  describe('initial average', () => {
    let memory: Memory;
    let average: ReturnType<typeof Memory.prototype.getAverage>;
    const size = 10;
    const units = 'KB';

    beforeEach(() => {
      memory = new Memory({ size, units });
      average = memory.getAverage();
    });

    it('should have correct bytes', () => {
      expect(average.bytes).toBe(0);
    });

    it('should have correct units', () => {
      expect(average.units).toBe(0);
    });

    it('should have correct percentage', () => {
      expect(average.prs).toBe(0);
    });
  });

  describe('addBytes()', () => {
    let memory: Memory;
    const size = 100;
    const addBytes = 5;
    const units = 'GB';

    beforeEach(() => {
      memory = new Memory({ size, units });
    });

    it('should return remaining bytes', () => {
      const remainingBytes = memory.addBytes(addBytes);
      expect(remainingBytes).toBe(size * UNITS[units] - addBytes);
    });

    it('should return negative value if overflow', () => {
      memory.addBytes(size * UNITS[units]);
      const remainingBytes = memory.addBytes(addBytes);
      expect(remainingBytes).toBe(-addBytes);
    });

    it('should add bytes', () => {
      memory.addBytes(addBytes);
      expect(memory.getUsedSpace().bytes).toBe(addBytes);
    });

    it('should have correct free space', () => {
      memory.addBytes(addBytes);
      const freeSpace = memory.getFreeSpace();
      expect(freeSpace.bytes).toBe(size * UNITS[units] - addBytes);
      expect(freeSpace.units).toBe(freeSpace.bytes / UNITS[units]);
      expect(freeSpace.prs).toBe(
        100 - (addBytes / (size * UNITS[units])) * 100,
      );
    });

    it('should have correct used space', () => {
      memory.addBytes(addBytes);
      const usedSpace = memory.getUsedSpace();
      expect(usedSpace.bytes).toBe(addBytes);
      expect(usedSpace.units).toBe(addBytes / UNITS[units]);
      expect(usedSpace.prs).toBe((addBytes / (size * UNITS[units])) * 100);
    });

    it('should have correct average', () => {
      memory.addBytes(addBytes);
      const average = memory.getAverage();
      expect(average.bytes).toBe(addBytes);
      expect(average.units).toBe(addBytes / UNITS[units]);
      expect(average.prs).toBe((addBytes / (size * UNITS[units])) * 100);
    });

    it('should not emit overflow', () => {
      const spy = vi.fn();
      memory.on('overflow', spy);
      memory.addBytes(size * UNITS[units]);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should emit overflow event', () => {
      const max = size * UNITS[units];
      const spy = vi.fn();
      memory.on('overflow', spy);
      memory.addBytes(max + addBytes);
      expect(spy).toHaveBeenCalledWith({
        type: 'overflow',
        target: memory,
        bytes: -addBytes,
      });
    });

    it('should not call overflow event if not overflow', () => {
      const spy = vi.fn();
      memory.on('overflow', spy);
      memory.addBytes(addBytes);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    let memory: Memory;
    const size = 10;
    const units = 'MB';

    beforeEach(() => {
      memory = new Memory({ size, units });
    });

    it('should clear memory', () => {
      memory.addBytes(5);
      memory.clear();
      expect(memory.getState().count).toBe(0);
      expect(memory.getUsedSpace().bytes).toBe(0);
      expect(memory.getFreeSpace().bytes).toBe(size * UNITS[units]);
    });

    it('should emit clear event', () => {
      const spy = vi.fn();
      memory.on('clear', spy);
      memory.clear();
      expect(spy).toHaveBeenCalledWith({
        type: 'clear',
        target: memory,
      });
    });
  });

  describe('addUnits()', () => {
    let memory: Memory;
    const size = 10;
    const units = 'KB';

    beforeEach(() => {
      memory = new Memory({ size, units });
    });

    it('should add units', () => {
      memory.addUnits(1);
      expect(memory.getUsedSpace().units).toBe(1);
    });

    it('should add bytes', () => {
      memory.addUnits(1);
      expect(memory.getUsedSpace().bytes).toBe(UNITS[units]);
    });

    it('should return negative value if overflow', () => {
      const remainingUnits = memory.addUnits(size + 1);
      expect(remainingUnits).toBe(-1);
    });

    it('should set correct free space', () => {
      memory.addUnits(1);
      const freeSpace = memory.getFreeSpace();
      expect(freeSpace.bytes).toBe(size * UNITS[units] - UNITS[units]);
      expect(freeSpace.units).toBe(size - 1);
      expect(freeSpace.prs).toBe(90);
    });
  });
});
