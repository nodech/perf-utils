/*!
 * performance.js - Performance utils for node.js
 * Copyright (c) 2021, Nodari Chkuaselidze (MIT License).
 * https://github.com/nodech/perf-utils
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const {PerformanceObserver, performance} = require('perf_hooks');

/**
 * TODO: Test if moving this to the worker is better.
 */

class PerformanceLogger {
  constructor(options) {
    this.console = true;
    this.filename = null;

    this.observer = null;

    // TODO: Use stream instead.
    this.fd = null;

    if (options != null)
      this.fromOptions(options);
  }

  fromOptions(options) {
    assert(options);

    if (options.filename != null) {
      assert(typeof options.filename === 'string');
      this.filename = options.filename;
    }

    if (options.console != null) {
      assert(typeof options.console === 'boolean');
      this.console = options.console;
    }

    if (!this.filename && !this.console)
      throw new Error('You need to choose the logger.');
  }

  async open() {
    if (this.filename != null)
      this.fd = await fs.promises.open(this.filename, 'a+');

    await this.start();
  }

  async close() {
    await this.stop();

    if (this.fd != null)
      await this.fd.close();

    this.fd = null;
    this.observer = null;
  }

  async start() {
    const observeCb = this.observeCallback.bind(this);
    this.observer = new PerformanceObserver(observeCb);
    this.observer.observe({ type: 'measure' });
  }

  async stop() {
    const items = this.observer.takeRecords();
    await this.observeCallback(items);
    this.observer.disconnect();
  }

  async observeCallback(items) {
    for (const item of items.getEntries()) {
      const formatted = this.format(item);

      if (this.console)
        console.log(formatted);

      if (this.fd)
        await this.fd.write(formatted + '\n');
    }
  }

  format(item) {
    return `${item.name} - ${item.duration.toFixed(2)} ms`;
  }
}

let ID = 0;

/**
 * @param {String} name
 * @returns {function} - mark & measure
 */

function start(name) {
  name += `:${ID++}`;
  let lastname = name;
  performance.mark(lastname);

  const markMeasure = (markName) => {
    const fullname = `${name}-${markName}` ;

    performance.mark(fullname);
    performance.measure(fullname, lastname, fullname);
    lastname = fullname;
  };

  return markMeasure;
}

exports.PerformanceLogger = PerformanceLogger;
exports.performance = performance;
exports.start = start;
