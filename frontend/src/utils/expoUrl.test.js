import { describe, expect, it } from 'vitest';
import { expoGoUrl } from './expoUrl';

describe('expoGoUrl', () => {
  it('points Expo Go at this computer on the network', () => {
    expect(expoGoUrl({ hostname: '192.168.1.5' }, {})).toBe('exp://192.168.1.5:8081');
    expect(expoGoUrl({ hostname: '192.168.1.5' }, { VITE_EXPO_PORT: '19000' })).toBe('exp://192.168.1.5:19000');
  });

  it('has no usable address when the page is open on localhost', () => {
    expect(expoGoUrl({ hostname: 'localhost' }, {})).toBeNull();
    expect(expoGoUrl({ hostname: '127.0.0.1' }, {})).toBeNull();
  });

  it('uses an explicit address when one is configured', () => {
    expect(expoGoUrl({ hostname: 'localhost' }, { VITE_EXPO_URL: 'exp://10.0.0.2:8081' })).toBe('exp://10.0.0.2:8081');
  });
});
