import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/index.js';

test('humo: el módulo carga y expone VERSION', () => {
  assert.equal(typeof VERSION, 'string');
});
