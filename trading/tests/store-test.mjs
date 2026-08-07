import assert from 'node:assert/strict';
import { defaultState, validateState, importState, exportState } from '../lib/store.js';

const s = defaultState();
assert.equal(validateState(s).ok, true);
assert.equal(validateState({}).ok, false);

const text = exportState(s);
const imp = importState(text);
assert.equal(imp.ok, true);
assert.equal(imp.state.schemaVersion, 1);

assert.equal(importState('{bad').ok, false);
console.log('store-test OK');
