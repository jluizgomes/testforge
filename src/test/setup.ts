import '@testing-library/jest-dom'

// Mock localStorage for Zustand persist middleware
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

// Mock window.electronAPI (not present in jsdom)
Object.defineProperty(window, 'electronAPI', {
  value: undefined,
  writable: true,
})

// Suppress console.error for React missing act() warnings in tests
const originalError = console.error
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning:')
    ) return
    originalError(...args)
  }
})

afterAll(() => {
  console.error = originalError
})
