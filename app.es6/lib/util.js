/**
 * @param {string} s
 * @return {Buffer}
 */
function decode (s) {
  return Array.prototype.reverse.call(new Buffer(s, 'hex'))
}

/**
 * @param {Buffer} s
 * @return {string}
 */
function encode (s) {
  return Array.prototype.reverse.call(new Buffer(s)).toString('hex')
}

/**
 * @class ConcurrentImport
 */
class ConcurrentImport {
  /**
   * @constructor
   */
  constructor () {
    this._launched = false
    this._qBlocks = []
    this._qTxs = []
  }

  /**
   */
  _pulse () {
    if (this._qBlocks.length > 0) {
      return this._qBlocks.shift().resolve()
    }

    if (this._qTxs.length > 0) {
      return this._qTxs.shift().resolve()
    }

    this._launched = false
  }

  /**
   * @param {function} fn
   * @param {Object} ctx
   * @param {string} type
   * @return {function}
   */
  apply (fn, ctx, type) {
    let queue = type === 'tx' ? this._qTxs : this._qBlocks

    return (...args) => {
      return new Promise((resolve) => {
        if (this._launched === false) {
          this._launched = true
          return resolve()
        }

        queue.push({resolve: resolve})
      })
      .then(() => { return fn.apply(ctx, args) })
      .then((value) => {
        this._pulse()
        return value
      }, (reason) => {
        this._pulse()
        throw reason
      })
    }
  }
}

export default {
  decode: decode,
  encode: encode,
  ConcurrentImport: ConcurrentImport
}
