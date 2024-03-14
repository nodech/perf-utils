/*!
 * trace.js - Trace
 * Copyright (c) 2024, Nodari Chkuaselidze (MIT License)
 */

'use strict';

const assert = require('assert');
const {performance} = require('perf_hooks');
const TraceFile = require('./tracefile');

class PerformanceTraces {
  /** @type {Object} */
  options;

  /** @type {String?} */
  filename;

  /** @type {TraceFile?} */
  file;

  /**
   * @param {Object} options
   * @param {String?} options.filename
   * @param {Boolean?} options.console
   */

  constructor(options) {
    this.options = options;

    this.filename = null;
    this.file = null;

    if (options != null)
      this.fromOptions(options);

    this.init();
  }

  /**
   * @param {Object} options
   * @param {String?} options.filename
   * @param {Boolean?} options.console
   * @returns {this}
   */

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

    return this;
  }

  init() {
    if (this.options.filename)
      this.file = new TraceFile(this.options);
  }

  async open() {
    if (this.file)
      await this.file.open();
  }

  async close() {
    if (this.file)
      await this.file.close();
  }

  /**
   * @param {String} name
   * @param {String} phase
   */

  trace(name, phase) {
    const mark = markTrace(name, phase);

    if (this.file)
      this.file.writeTrace(mark);

    if (this.console)
      console.log(JSON.stringify(mark));
  }

  /**
   * @param {Function} fn
   * @param {String?} name
   * @returns {Function}
   */

  timerifyFn(fn, name = '') {
    const fullname = `${name}:${fn.name}`;
    /** @type {ProxyHandler} */
    const handler = {
      apply: (target, thisArg, argumentsList) => {
        this.trace(fullname, 'B');

        try {
          const result = Reflect.apply(target, thisArg, argumentsList);

          if (result instanceof Promise) {
            return result
              .then((res) => {
                this.trace(fullname, 'E')
                return res;
              })
              .catch((e) => {
                this.trace(fullname, 'E');
                throw e;
              });
          }

          this.trace(fullname, 'E');
          return result;
        } catch (e) {
          this.trace(fullname, 'E');
          throw e;
        }
      }
    };

    return new Proxy(fn, handler);
  }

  /**
   * @param {Object} obj
   * @param {String?} name
   * @returns {Object}
   */

  timerify(obj, name = '') {
    /** @type {ProxyHandler} */
    const handler = {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);

        if (typeof value === 'function') {
          console.log('Calling: ', prop);
          return this.timerifyFn(value, name);
        }

        return value;
      }
    };

    return new Proxy(obj, handler);
  }

  /**
   * Aggresive monkey patching
   * @param {Object} tclass
   * @param {String?} name
   * @returns {Object}
   */

  timerifyClass(tclass, name = '') {
    for (const prop of Object.getOwnPropertyNames(tclass.prototype)) {
      if (prop === 'constructor')
        continue;

      const value = tclass.prototype[prop];

      if (typeof value === 'function') {
        tclass.prototype[prop] = this.timerifyFn(value, name);
      }
    }
  }
}

/**
 * @param {String} name
 * @param {String} phase
 */

function markTrace(name, phase) {
  return {
    pid: process.pid,
    tid: process.pid,
    ts: performance.now(),

    name: name,
    ph: phase,
  };
}

exports.PerformanceTraces = PerformanceTraces;
