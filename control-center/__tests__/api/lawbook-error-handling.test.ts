/**
 * Tests for lawbook endpoints - ensuring no unhandled 500 errors
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getParameters } from '../../app/api/lawbook/parameters/route';
import { GET as getGuardrails } from '../../app/api/lawbook/guardrails/route';
import { GET as getMemory } from '../../app/api/lawbook/memory/route';

jest.mock('../../src/lawbook/load', () => ({
  loadParameters: jest.fn(),
  loadGuardrails: jest.fn(),
  loadMemorySeed: jest.fn(),
  computeStableHash: jest.fn(() => 'test-hash-123'),
}));

describe('Lawbook endpoints - Error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/lawbook/parameters', () => {
    test('returns 200 with valid data', async () => {
      const { loadParameters } = require('../../src/lawbook/load');
      loadParameters.mockResolvedValue({
        hash: 'param-hash',
        data: {
          version: '1.0.0',
          parameters: { key: 'value' },
        },
      });

      const req = new NextRequest('http://localhost/api/lawbook/parameters');
      const res = await getParameters(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('hash', 'param-hash');
      expect(body).toHaveProperty('version', '1.0.0');
      expect(body).toHaveProperty('parameters');
    });

    test('returns 500 with structured error on failure', async () => {
      const { loadParameters } = require('../../src/lawbook/load');
      loadParameters.mockRejectedValue(new Error('File not found'));

      const req = new NextRequest('http://localhost/api/lawbook/parameters');
      const res = await getParameters(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Failed to load lawbook parameters');
      expect(body).toHaveProperty('details', 'File not found');
      expect(body).toHaveProperty('requestId');
      expect(body).toHaveProperty('timestamp');
    });

    test('never returns unhandled 500', async () => {
      const { loadParameters } = require('../../src/lawbook/load');
      loadParameters.mockImplementation(() => {
        throw new Error('Catastrophic failure');
      });

      const req = new NextRequest('http://localhost/api/lawbook/parameters');
      const res = await getParameters(req);

      // Should still return a response, not throw
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty('requestId');
    });
  });

  describe('GET /api/lawbook/guardrails', () => {
    test('returns 200 with valid data', async () => {
      const { loadGuardrails } = require('../../src/lawbook/load');
      loadGuardrails.mockResolvedValue({
        hash: 'guard-hash',
        data: {
          version: '1.0.0',
          guardrails: [{ id: 'g1', rule: 'test' }],
        },
      });

      const req = new NextRequest('http://localhost/api/lawbook/guardrails');
      const res = await getGuardrails(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('hash', 'guard-hash');
      expect(body).toHaveProperty('version', '1.0.0');
      expect(body).toHaveProperty('guardrails');
      expect(body.guardrails).toHaveLength(1);
    });

    test('returns 500 with structured error on failure', async () => {
      const { loadGuardrails } = require('../../src/lawbook/load');
      loadGuardrails.mockRejectedValue(new Error('Parse error'));

      const req = new NextRequest('http://localhost/api/lawbook/guardrails');
      const res = await getGuardrails(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Failed to load lawbook guardrails');
      expect(body).toHaveProperty('details', 'Parse error');
      expect(body).toHaveProperty('requestId');
    });

    test('never returns unhandled 500', async () => {
      const { loadGuardrails } = require('../../src/lawbook/load');
      loadGuardrails.mockImplementation(() => {
        throw new TypeError('Unexpected type');
      });

      const req = new NextRequest('http://localhost/api/lawbook/guardrails');
      const res = await getGuardrails(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty('requestId');
    });
  });

  describe('GET /api/lawbook/memory', () => {
    test('returns 200 with valid data', async () => {
      const { loadMemorySeed } = require('../../src/lawbook/load');
      loadMemorySeed.mockResolvedValue({
        hash: 'mem-hash',
        data: {
          version: '1.0.0',
          entries: [{ id: 'm1', content: 'test' }],
        },
      });

      const req = new NextRequest('http://localhost/api/lawbook/memory');
      const res = await getMemory(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('seed');
      expect(body).toHaveProperty('session');
      expect(body).toHaveProperty('hash');
      expect(body.seed.entries).toHaveLength(1);
    });

    test('returns 500 with structured error on failure', async () => {
      const { loadMemorySeed } = require('../../src/lawbook/load');
      loadMemorySeed.mockRejectedValue(new Error('Memory load failed'));

      const req = new NextRequest('http://localhost/api/lawbook/memory');
      const res = await getMemory(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Failed to load lawbook memory');
      expect(body).toHaveProperty('details', 'Memory load failed');
      expect(body).toHaveProperty('requestId');
    });

    test('never returns unhandled 500', async () => {
      const { loadMemorySeed } = require('../../src/lawbook/load');
      loadMemorySeed.mockImplementation(() => {
        throw new Error('Critical error');
      });

      const req = new NextRequest('http://localhost/api/lawbook/memory');
      const res = await getMemory(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty('requestId');
    });
  });

  describe('All lawbook endpoints', () => {
    test('always include requestId in error responses', async () => {
      const { loadParameters, loadGuardrails, loadMemorySeed } = require('../../src/lawbook/load');
      
      loadParameters.mockRejectedValue(new Error('Test error'));
      loadGuardrails.mockRejectedValue(new Error('Test error'));
      loadMemorySeed.mockRejectedValue(new Error('Test error'));

      const requests = [
        getParameters(new NextRequest('http://localhost/api/lawbook/parameters')),
        getGuardrails(new NextRequest('http://localhost/api/lawbook/guardrails')),
        getMemory(new NextRequest('http://localhost/api/lawbook/memory')),
      ];

      const responses = await Promise.all(requests);

      for (const res of responses) {
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      }
    });

    test('always include timestamp in error responses', async () => {
      const { loadParameters } = require('../../src/lawbook/load');
      loadParameters.mockRejectedValue(new Error('Test error'));

      const req = new NextRequest('http://localhost/api/lawbook/parameters');
      const res = await getParameters(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
