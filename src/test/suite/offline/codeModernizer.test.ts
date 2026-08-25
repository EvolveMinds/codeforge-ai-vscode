/**
 * test/suite/offline/codeModernizer.test.ts — Unit tests for deterministic code modernizer
 */

import * as assert from 'assert';
import { CodeModernizer } from '../../../offline/codeModernizer';

suite('Offline Code Modernizer Suite', () => {
  test('modernizes Python type hints to PEP 604 & PEP 585 syntax', () => {
    const pythonCode = `
from typing import Optional, Union, List, Dict

def process_items(users: List[str], config: Optional[Dict[str, Union[int, str]]]) -> Union[bool, None]:
    pass
`;

    const res = CodeModernizer.modernizePython(pythonCode);
    assert.strictEqual(res.modified, true);
    assert.ok(res.code.includes('users: list[str]'));
    assert.ok(res.code.includes('dict[str, int | str] | None'));
    assert.ok(res.code.includes('-> bool | None:'));
  });

  test('converts legacy os.path functions to pathlib.Path', () => {
    const pythonCode = `
import os

target = os.path.join(base_dir, "output.csv")
if os.path.exists(target):
    name = os.path.basename(target)
    parent = os.path.dirname(target)
`;

    const res = CodeModernizer.modernizePython(pythonCode);
    assert.strictEqual(res.modified, true);
    assert.ok(res.code.includes('from pathlib import Path'));
    assert.ok(res.code.includes('Path(base_dir) / "output.csv"'));
    assert.ok(res.code.includes('Path(target).exists()'));
    assert.ok(res.code.includes('Path(target).name'));
    assert.ok(res.code.includes('Path(target).parent'));
  });

  test('converts CommonJS require and module.exports to ESM in JavaScript', () => {
    const jsCode = `
const express = require('express');
const { readFileSync, writeFileSync } = require('fs');

const app = express();

module.exports = app;
`;

    const res = CodeModernizer.modernizeJavaScript(jsCode);
    assert.strictEqual(res.modified, true);
    assert.ok(res.code.includes("import express from 'express';"));
    assert.ok(res.code.includes("import { readFileSync, writeFileSync } from 'fs';"));
    assert.ok(res.code.includes('export default app;'));
  });
});
