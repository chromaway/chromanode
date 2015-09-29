import _ from 'lodash'

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
 * @class SmartLock
 */
class SmartLock {
  /**
   * @constructor
   */
  constructor () {
    this._locks = {}
    this._reorgPromise = null
  }

  /**
   * @param {Array.<string>} txids
   * @param {function} fn
   * @return {Promise}
   */
  async withLock (txids, fn) {
    let lockResolve
    let lockPromise = new Promise((resolve) => { lockResolve = resolve })
    let lockedTxIds = []

    try {
      while (true) {
        let locks = _.filter(txids.map((txid) => this._locks[txid]))
        if (locks.length === 0) {
          for (let txid of txids) {
            this._locks[txid] = lockPromise
            lockedTxIds.push(txid)
          }
          break
        }

        await* locks
      }

      if (this._reorgPromise !== null) {
        await this._reorgPromise
      }

      return await fn()
    } finally {
      for (let txid of lockedTxIds) {
        delete this._locks[txid]
      }

      lockResolve()
    }
  }

  /**
   * @param {function} fn
   * @return {Promise}
   */
  async reorgLock (fn) {
    let lockResolve
    this._reorgPromise = new Promise((resolve) => { lockResolve = resolve })

    try {
      await* _.values(this._locks)
      return await fn()
    } finally {
      this._reorgPromise = null
      lockResolve()
    }
  }
}

export default {
  decode: decode,
  encode: encode,
  SmartLock: SmartLock
}
