import '@testing-library/jest-dom'
import { expect, afterEach, vi } from 'vitest'

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});
