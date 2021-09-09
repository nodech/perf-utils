/*!
 * fs.js - Minimal fs wrapper for node.js
 * Copyright (c) 2021, Nodari Chkuaselidze (MIT License).
 * https://github.com/nodech/perf-utils
 */

'use strict';

const fs = require('fs');
const mfs = module.exports;

if (fs.promises) {
  mfs.open = fs.promises.open;
}
