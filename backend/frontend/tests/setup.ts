import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

function readStorage(name: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return window[name];
  } catch {
    return undefined;
  }
}

const originalLocalStorage = readStorage("localStorage");
const originalSessionStorage = readStorage("sessionStorage");

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(String(key));
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  };
}

function isCompleteStorage(value: unknown): value is Storage {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as Storage).getItem === "function" &&
      typeof (value as Storage).setItem === "function" &&
      typeof (value as Storage).removeItem === "function" &&
      typeof (value as Storage).clear === "function" &&
      typeof (value as Storage).key === "function" &&
      typeof (value as Storage).length === "number",
  );
}

function installStorage(name: "localStorage" | "sessionStorage", storage: Storage) {
  Object.defineProperty(window, name, {
    configurable: true,
    value: storage,
  });
}

function restoreStorage(name: "localStorage" | "sessionStorage", original: Storage | undefined) {
  installStorage(name, isCompleteStorage(original) ? original : createStorageMock());
}

beforeEach(() => {
  restoreStorage("localStorage", originalLocalStorage);
  restoreStorage("sessionStorage", originalSessionStorage);
});

afterEach(() => {
  cleanup();
  restoreStorage("localStorage", originalLocalStorage);
  restoreStorage("sessionStorage", originalSessionStorage);
  window.localStorage.clear();
  window.sessionStorage.clear();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
});

Element.prototype.scrollTo = vi.fn();
