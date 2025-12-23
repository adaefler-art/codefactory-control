// Jest setup file
// This file is executed before each test file

import '@testing-library/jest-dom';

// Polyfills for Node/JSDOM test environment
// - pg (and other deps) may require TextEncoder/TextDecoder
// - some codepaths expect WebCrypto (globalThis.crypto)
import { TextDecoder, TextEncoder } from 'util';

if (typeof globalThis.TextEncoder === 'undefined') {
	// @ts-expect-error - assign polyfill
	globalThis.TextEncoder = TextEncoder;
}

if (typeof globalThis.TextDecoder === 'undefined') {
	// @ts-expect-error - assign polyfill
	globalThis.TextDecoder = TextDecoder;
}

// Ensure global WebCrypto is available for libs that rely on it.
// Node 18+ provides it, but JSDOM environments can be inconsistent.
if (typeof globalThis.crypto === 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const nodeCrypto = require('crypto');
	globalThis.crypto = nodeCrypto.webcrypto;
}
