import { TextDecoder, TextEncoder } from 'node:util';

// jsdom ships no TextEncoder/TextDecoder, which `effect` reaches for on import.
Object.assign(globalThis, { TextEncoder, TextDecoder });
