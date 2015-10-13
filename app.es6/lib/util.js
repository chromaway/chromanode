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
 * @param {bitcore.Transaction[]} txs
 * @return {bitcore.Transaction[]}
 */
function toposort (txs) {
  let indexByTxId = _.zipObject(txs.map((tx, index) => [tx.id, index]))
  let existingTx = _.zipObject(_.keys(indexByTxId).map((txId) => [txId, true]))
  let isSortedByIndex = new Array(txs.length).fill(false)
  let result = []

  /**
   * @param {number} index
   * @param {number} topIndex
   */
  function sort (index, topIndex) {
    if (isSortedByIndex[index] === true) {
      return
    }

    for (let input of txs[index].inputs) {
      let prevTxId = input.prevTxId.toString('hex')
      if (existingTx[prevTxId] !== undefined) {
        let prevIndex = indexByTxId[prevTxId]
        if (prevIndex === topIndex) {
          throw new Error('Graph is cyclical')
        }

        sort(prevIndex, topIndex)
      }
    }

    isSortedByIndex[index] = true
    result.push(txs[index])
  }

  for (let index = 0; index < txs.length; index += 1) {
    sort(index, index)
  }

  return result
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
    this._exclusivePromise = null
  }

  /**
   * @param {Array.<string>} txIds
   * @param {function} fn
   * @return {Promise}
   */
  async withLock (txIds, fn) {
    let lockResolve
    let lockPromise = new Promise((resolve) => lockResolve = resolve)
    let lockedTxIds = []

    try {
      while (true) {
        let locks = _.filter(txIds.map((txId) => this._locks[txId]))
        if (locks.length === 0) {
          for (let txId of txIds) {
            this._locks[txId] = lockPromise
            lockedTxIds.push(txId)
          }

          break
        }

        await* locks
      }

      if (this._exclusivePromise !== null) {
        await this._exclusivePromise
      }

      return await fn()
    } finally {
      for (let txId of lockedTxIds) {
        delete this._locks[txId]
      }

      lockResolve()
    }
  }

  /**
   * @param {function} fn
   * @return {Promise}
   */
  async exclusiveLock (fn) {
    let lockResolve
    this._exclusivePromise = new Promise((resolve) => lockResolve = resolve)

    try {
      await* _.values(this._locks)
      return await fn()
    } finally {
      this._exclusivePromise = null
      lockResolve()
    }
  }
}

export default {
  decode: decode,
  encode: encode,
  toposort: toposort,
  SmartLock: SmartLock
}
