import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
// jsdom has no layout or native scrolling; browser verification covers geometry.
Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })
