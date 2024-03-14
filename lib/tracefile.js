/*!
 * tracefile.js - Log traces
 * Copyright (c) 2024, Nodari Chkuaselidze (MIT License)
 *
 * Parts of this are based on
 * https://github.com/bcoin-org/blgr/blob/050cbb587a1654a078468dbb92606330fdc4d120/lib/logger.js
 */

'use strict';

const assert = require('assert');
const bfs = require('bfile');
const path = require('path');

/** @typedef {import('fs').WriteStream} WriteStream */

/**
 * Trace logs.
 * @property {WriteStream} stream
 * @property {Number} fileSize
 * @property {Boolean} rotating
 * @property {Boolean} closed
 * @property {Boolean} closing
 * @property {String} filename
 * @property {Number} maxFiles
 * @property {Number} maxFileSize
 */

class RotatingTraceLog {
  /** @type {WriteStream?} */
  stream;

  /** @type {Number} */
  fileSize;

  /** @type {Boolean} */
  closed;

  /** @type {Boolean} */
  closing;

  /** @type {Boolean} */
  rotating;

  /** @type {String?} */
  filename;

  /** @type {Number} */
  maxFiles;

  /** @type {Number} */
  maxFileSize;

  /** @type {Number} */
  id;

  /** @type {Boolean} */
  firstEntry;

  /**
   * @param {Object} options
   */

  constructor(options) {
    this.stream = null;
    this.fileSize = 0;

    this.closed = true;
    this.closing = false;
    this.rotating = false;
    this._bufferedEntries = [];

    this.filename = null;
    this.maxFiles = 0;
    this.maxFileSize = 100e6;

    this.id = 0;
    this.firstEntry = true;

    this.fromOptions(options);
  }

  /**
   * Check and apply options.
   * @param {Object} options
   * @returns {this}
   */

  fromOptions(options) {
    assert(typeof options === 'object');
    assert(typeof options.filename === 'string');

    this.filename = options.filename;

    if (options.maxFiles != null) {
      assert(typeof options.maxFiles === 'number');
      assert((options.maxFiles >>> 0) === options.maxFiles);
      this.maxFiles = options.maxFiles;
    }

    if (options.maxFileSize != null) {
      assert(typeof options.maxFileSize === 'number');
      assert((options.maxFileSize >>> 0) === options.maxFileSize);
      this.maxFileSize = options.maxFileSize;
    }

    return this;
  }

  handleError(error) {
    try {
      this.stream.close();
    } catch (e) {
      ;
    }

    this.closed = true;
    this.stream = null;
    this.retry();
  }

  /**
   * Try opening.
   * @returns {Promise}
   */

  async open() {
    assert(this.filename, 'filename not found');
    assert(!this.stream, 'Already open.');
    assert(this.closed, 'File is alredy open.');

    this.fileSize = await this.getFileSize();

    try {
      this.stream = await openStream(this.filename, {
        flags: 'w',
        autoClose: true
      });
    } catch (e) {
      this.retry();
      return;
    }

    this.closed = false;
    this.stream.once('error', e => this.handleError(e));

    while (this._bufferedEntries.length > 0 && !this.rotating) {
      const msg = this._bufferedEntries.shift();

      if (!this.writeTrace(msg)) {
        this._bufferedEntries.unshift(msg);
        break;
      }
    }
  }

  /**
   * Try closing stream.
   * May not write some data if the file was rotationg.
   * @returns {Promise}
   */

  async close() {
    assert(!this.closed);
    assert(this.stream);


    this.closing = true;
    try {
      this.stream.write(']}');
      await endStream(this.stream);
      await closeStream(this.stream);
    } finally {
      this.closing = false;
    }

    this.stream = null;
    this.closed = true;
  }

  retry() {
    if (this.timer != null)
      return;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, 1000);
  }

  /**
   * Write data to the file. (may rotate)
   * @param {Object} json
   * @returns {Boolean} - false - if we can't write nor buffer.
   */

  writeTrace(json) {
    if (!this.stream && !this.rotating) {
      return false;
    }

    if (this.closing && !this.rotating) {
      return false;
    }

    if (this.rotating) {
      this._bufferedEntries.push(json);
      return true;
    }

    const str = JSON.stringify(json);

    if (!this.firstEntry) {
      this.stream.write(',' + str);
    } else {
      this.stream.write('{"traceEvents": [');
      this.stream.write(str);
      this.firstEntry = false;
    }

    this.fileSize += json.length;

    if (this.fileSize >= this.maxFileSize)
      this.rotate();

    return true;
  }

  /**
   * @private
   * @returns {Promise}
   */

  async rotate() {
    if (this.rotating)
      return;

    if (!this.stream || this.closed)
      return;

    this.rotating = true;

    assert(this.filename);
    await this.close();
    const ext = path.extname(this.filename);
    const base = path.basename(this.filename, ext);
    const dir = path.dirname(this.filename);

    const rename = path.join(dir, base + '.' + this.id + ext);

    await bfs.rename(this.filename, rename);

    this.rotating = false;
    this.id++;

    await this.open();
    return;
  }

  /**
   * get size of the current active file.
   * @returns {Promise<Number>}
   */

  async getFileSize() {
    try {
      const stat = await bfs.stat(this.filename);
      return stat.size;
    } catch (e) {
      if (e.code === 'ENOENT')
        return 0;

      throw e;
    }
  }
}

/**
 * @param {String} filename
 * @param {Object} flags
 * @returns {Promise<WriteStream>}
 */

function openStream(filename, flags) {
  return new Promise((resolve, reject) => {
    const stream = bfs.createWriteStream(filename, flags);

    const cleanup = () => {
      /* eslint-disable */
      stream.removeListener('error', onError);
      stream.removeListener('open', onOpen);
      /* eslint-enable */
    };

    const onError = (err) => {
      try {
        stream.close();
      } catch (e) {
        ;
      }
      cleanup();
      reject(err);
    };

    const onOpen = () => {
      cleanup();
      resolve(stream);
    };

    stream.once('error', onError);
    stream.once('open', onOpen);
  });
}

/**
 * @param {WriteStream} stream
 * @returns {Promise}
 */

function endStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once('finish', resolve);
    stream.end();
  });
}

/**
 * @param {WriteStream} stream
 * @returns {Promise}
 */

function closeStream(stream) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      /* eslint-disable */
      stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
      /* eslint-enable */
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      resolve(stream);
    };

    stream.removeAllListeners('error');
    stream.removeAllListeners('close');
    stream.once('error', onError);
    stream.once('close', onClose);

    stream.close();
  });
}

module.exports = RotatingTraceLog;
