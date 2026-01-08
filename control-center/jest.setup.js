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

// Ensure crypto.randomUUID is available (needed by API routes)
if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const nodeCrypto = require('crypto');
	globalThis.crypto.randomUUID = nodeCrypto.randomUUID;
}

// Next.js (next/server) expects Fetch API globals (Request/Response/Headers).
// Jest's Node environment may not provide these depending on runtime/version.
// Keep this minimal: enough for middleware imports + basic response assertions.
if (typeof globalThis.Headers === 'undefined') {
	class MinimalHeaders {
		constructor(init = undefined) {
			this._map = new Map();
			if (init instanceof MinimalHeaders) {
				init.forEach((value, key) => this.set(key, value));
			} else if (init && typeof init === 'object') {
				for (const [key, value] of Object.entries(init)) {
					this.set(key, String(value));
				}
			}
		}

		_normalizeName(name) {
			return String(name).toLowerCase();
		}

		get(name) {
			return this._map.get(this._normalizeName(name)) ?? null;
		}

		set(name, value) {
			this._map.set(this._normalizeName(name), String(value));
		}

		append(name, value) {
			const key = this._normalizeName(name);
			const existing = this._map.get(key);
			this._map.set(key, existing ? `${existing}, ${String(value)}` : String(value));
		}

		has(name) {
			return this._map.has(this._normalizeName(name));
		}

		delete(name) {
			this._map.delete(this._normalizeName(name));
		}

		forEach(callback) {
			for (const [key, value] of this._map.entries()) {
				callback(value, key, this);
			}
		}

		[Symbol.iterator]() {
			return this._map.entries();
		}
	}

	// @ts-expect-error - assign polyfill
	globalThis.Headers = MinimalHeaders;
}

if (typeof globalThis.Request === 'undefined') {
	class MinimalRequest {
		constructor(input, init = undefined) {
			const urlValue = typeof input === 'string' ? input : String(input?.url ?? input);
			Object.defineProperty(this, 'url', {
				value: urlValue,
				writable: true,
				enumerable: true,
				configurable: true,
			});
			this.method = String(init?.method ?? 'GET');
			// @ts-expect-error - Headers polyfill exists above
			this.headers = new globalThis.Headers(init?.headers ?? undefined);
			this.body = init?.body;
		}

		async json() {
			if (typeof this.body === 'string') {
				return JSON.parse(this.body);
			}
			return this.body;
		}

		clone() {
			return new MinimalRequest(this.url, {
				method: this.method,
				headers: this.headers,
				body: this.body,
			});
		}
	}

	// @ts-expect-error - assign polyfill
	globalThis.Request = MinimalRequest;
}

if (typeof globalThis.Response === 'undefined') {
	class MinimalResponse {
		constructor(body = null, init = undefined) {
			this.body = body;
			this.status = Number(init?.status ?? 200);
			// @ts-expect-error - Headers polyfill exists above
			this.headers = new globalThis.Headers(init?.headers ?? undefined);
		}

		async json() {
			if (typeof this.body === 'string') {
				return JSON.parse(this.body);
			}
			return this.body;
		}

		static json(data, init = undefined) {
			const headersInit = init?.headers && typeof init.headers === 'object' ? init.headers : undefined;
			// @ts-expect-error - Headers polyfill exists above
			const headers = new globalThis.Headers(headersInit ?? undefined);
			if (!headers.get('content-type')) {
				headers.set('content-type', 'application/json');
			}
			return new MinimalResponse(JSON.stringify(data), {
				...(init ?? {}),
				headers,
			});
		}

		static redirect(url, status = 302) {
			// @ts-expect-error - Headers polyfill exists above
			const headers = new globalThis.Headers({ location: String(url) });
			return new MinimalResponse(null, { status, headers });
		}
	}

	// @ts-expect-error - assign polyfill
	globalThis.Response = MinimalResponse;
}
