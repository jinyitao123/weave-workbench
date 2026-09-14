import { describe, expect, it } from 'vitest'
import { productHostUrl } from '../src/host-supervisor.ts'

describe('desktop product Host readiness', () => {
  it('accepts only a tokenized loopback root URL from the real Host announcement', () => {
    expect(productHostUrl('dsh web: http://127.0.0.1:3080/?token=opaque')).toBe('http://127.0.0.1:3080/?token=opaque')
    expect(productHostUrl('dsh web: http://127.0.0.1:3080/?token=opaque (LAN: http://10.0.0.1:3080/?token=x)'))
      .toBe('http://127.0.0.1:3080/?token=opaque')
    for (const value of [
      'dsh web: http://localhost:3080/?token=opaque',
      'dsh web: https://127.0.0.1:3080/?token=opaque',
      'dsh web: http://127.0.0.1:3080/',
      'noise http://127.0.0.1:3080/?token=opaque',
    ]) expect(productHostUrl(value)).toBeUndefined()
  })
})
