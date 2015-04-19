/* globals Promise:true */

var _ = require('lodash')
var bitcore = require('bitcore')
var bufferEqual = require('buffer-equal')
var Promise = require('bluebird')

var errors = require('../../lib/errors')
var storage = require('../../lib/storage').default()
var util = require('../../lib/util')

var SQL = {
  selectLatest: 'SELECT ' +
                '  height as height, ' +
                '  blockid as blockid ' +
                'FROM blocks ' +
                '  ORDER BY height DESC ' +
                '  LIMIT 1',

  selectLatestHeader: 'SELECT ' +
                      '  height as height, ' +
                      '  blockid as blockid, ' +
                      '  header as header ' +
                      'FROM blocks ' +
                      '  ORDER BY height DESC ' +
                      '  LIMIT 1',

  selectHeightByHeight: 'SELECT ' +
                        '  height as height ' +
                        'FROM blocks ' +
                        '  WHERE height = $1',

  selectHeightByBlockId: 'SELECT ' +
                         '  height as height ' +
                         'FROM blocks ' +
                         '  WHERE blockid = $1',

  selectHeaders: 'SELECT ' +
                 '  header as header ' +
                 'FROM blocks ' +
                 '  WHERE height >= $1 AND height < $2' +
                 '  ORDER BY height ASC',

  selectBlocksHistory: 'SELECT ' +
                       '  txid as txid, ' +
                       '  index as index, ' +
                       '  prevtxid as prevtxid, ' +
                       '  outputindex as outputindex, ' +
                       '  height as height ' +
                       'FROM history ' +
                       '  WHERE ' +
                       '    height > $1 AND height <= $2 AND ' +
                       '    address = ANY($3)' +
                       '  ORDER BY height ASC',

  selectMempoolHistory: 'SELECT ' +
                        '  txid as txid, ' +
                        '  index as index, ' +
                        '  prevtxid as prevtxid, ' +
                        '  outputindex as outputindex ' +
                        'FROM history_mempool ' +
                        '  WHERE address = ANY($1)',

  selectBlocksRawTxByTxId: 'SELECT ' +
                           '  tx as tx ' +
                           'FROM transactions ' +
                           '  WHERE txid = $1',

  selectMempoolRawTxByTxId: 'SELECT ' +
                            '  tx as tx ' +
                            'FROM transactions_mempool ' +
                            '  WHERE txid = $1',

  selectHeightByTxId: 'SELECT ' +
                         '  height as height ' +
                         'FROM transactions ' +
                         '  WHERE txid = $1',

  selectTxIdsByHeight: 'SELECT ' +
                       '  height as height, ' +
                       '  blockid as blockid, ' +
                       '  txids as txids ' +
                       'FROM blocks ' +
                       '  WHERE height = $1',

  mempoolHasTx: 'SELECT ' +
                '  COUNT(*) ' +
                'FROM transactions_mempool ' +
                '  WHERE txid = $1'
}

/**
 * @param {string[]}
 * @return {string}
 */
function convertToAnyParam (arr) {
  return '{"' + arr.join('","') + '"}'
}

/**
 * @class DB
 */
function DB () {}

/**
 * @return {Promise<{height: number, blockid: string, header: string}>}
 */
DB.prototype.getLatestHeader = function () {
  return storage.execute(function (client) {
    return client.queryAsync(SQL.selectLatestHeader)
  })
  .then(function (result) {
    var row = result.rows[0]
    return {
      height: row.height,
      blockid: row.blockid.toString('hex'),
      header: row.header.toString('hex')
    }
  })
}

/**
 * @param {pg.Client} client
 * @param {(string|number)} point height or blockid
 * @return {Promise<?number>}
 */
DB.prototype._getHeightForPoint = function (client, point) {
  var args = _.isNumber(point)
               ? [SQL.selectHeightByHeight, [point]]
               : [SQL.selectHeightByBlockId, ['\\x' + point]]

  return client.queryAsync.apply(client, args)
    .then(function (result) {
      if (result.rowCount === 0) {
        return null
      }

      return result.rows[0].height
    })
}

/**
 * @param {Object} headersQuery
 * @param {number} headersQuery.from
 * @param {number} [headersQuery.to]
 * @param {string} [headersQuery.count]
 * @return {Promise<{from: number, count: number, headers: string}>}
 */
DB.prototype.headersQuery = function (query) {
  var self = this
  return storage.executeTransaction(function (client) {
    return self._getHeightForPoint(client, query.from)
      .then(function (from) {
        if (from === null) {
          throw new errors.Slave.FromNotFound()
        }

        if (query.to === undefined) {
          return [from, from + query.count]
        }

        return self._getHeightForPoint(client, query.to)
          .then(function (to) {
            if (to === null) {
              throw new errors.Slave.ToNotFound()
            }

            return [from, to]
          })
      })
      .spread(function (from, to) {
        var count = to - from
        if (count <= 0 || count > 2016) {
          throw new errors.Slave.InvalidRequestedCount()
        }

        return Promise.all([
          from,
          client.queryAsync(SQL.selectHeaders, [from, to])
        ])
      })
      .spread(function (from, result) {
        var headers = _.chain(result.rows)
          .pluck('header')
          .invoke('toString', 'hex')
          .join('')
          .value()

        return {from: from, count: headers.length / 160, headers: headers}
      })
  })
}

/**
 * @typedef DB~AddressesQueryResult
 * @property {Array.<{txid: string, height: ?number}>} transactions
 * @property {{height: number, blockid: string}} latest
 */

/**
 * @param {Object} query
 * @param {string[]} query.addresses
 * @param {string} [query.source]
 * @param {(string|number)} [query.from]
 * @param {(string|number)} [query.to]
 * @param {string} [query.status]
 * @return {Promise<DB~AddressesQueryResult>}
 */
DB.prototype.addressesQuery = function (query) {
  var self = this
  return storage.executeTransaction(function (client) {
    return client.queryAsync(SQL.selectLatest)
      .then(function (result) {
        var latest = result.rows[0]

        var from = query.from === undefined
                     ? -1
                     : self._getHeightForPoint(client, query.from)
        var to = query.to === undefined
                   ? latest.height
                   : self._getHeightForPoint(client, query.from)

        return Promise.all([latest, from, to])
      })
      .spread(function (latest, from, to) {
        if (from === null) {
          throw new errors.Slave.FromNotFound()
        }

        if (to === null) {
          throw new errors.Slave.ToNotFound()
        }

        var promises = [latest, {rows: []}, {rows: []}]
        if (query.source === undefined || query.source === 'blocks') {
          promises[1] = client.queryAsync(
            SQL.selectBlocksHistory,
            [from, to, convertToAnyParam(query.addresses)])
        }
        if (query.source === undefined || query.source === 'mempool') {
          promises[2] = client.queryAsync(
            SQL.selectMempoolHistory,
            [convertToAnyParam(query.addresses)])
        }

        return Promise.all(promises)
      })
      .spread(function (latest, bHistory, mHistory) {
        var history = bHistory.rows.concat(mHistory.rows).map(function (row) {
          row.txid = row.txid.toString('hex')
          row.prevtxid = row.prevtxid && row.prevtxid.toString('hex')
          row.height = _.isNumber(row.height) ? row.height : null
          return row
        })

        if (query.status === 'unspent') {
          var inputs = _.chain(history)
            .filter(function (item) {
              return item.prevtxid !== null
            })
            .map(function (item) {
              return [item.prevtxid + item.outputindex, true]
            })
            .zipObject()
            .value()

          history = history.filter(function (item) {
            // skip inputs
            if (item.prevtxid !== null) {
              return false
            }

            // check unspent
            return inputs[item.txid + item.index] === undefined
          })
        }

        var transactions = _.uniq(history.map(function (item) {
          return {txid: item.txid, height: item.height}
        }), 'txid')

        return {
          transactions: transactions,
          latest: {
            height: latest.height,
            hash: latest.blockid.toString('hex')
          }
        }
      })
  })
}

/**
 * @param {string} txid
 * @return {Promise<string>}
 */
DB.prototype.getRawTransaction = function (txid) {
  txid = '\\x' + txid

  return storage.execute(function (client) {
    return client.queryAsync(SQL.selectBlocksRawTxByTxId, [txid])
      .then(function (result) {
        if (result.rowCount > 0) {
          return result
        }

        return client.queryAsync(SQL.selectMempoolRawTxByTxId, [txid])
      })
      .then(function (result) {
        if (result.rowCount > 0) {
          return {hex: result.rows[0].tx.toString('hex')}
        }

        throw new errors.Slave.TxNotFound()
      })
  })
}

/**
 * @param {string} txid
 * @return {Promise<string>}
 */
DB.prototype.getMerkle = function (txid) {
  return storage.executeTransaction(function (client) {
    return client.queryAsync(SQL.mempoolHasTx, ['\\x' + txid])
      .then(function (result) {
        if (result.rows[0].count !== '0') {
          return {source: 'mempool'}
        }

        return client.queryAsync(SQL.selectHeightByTxId, ['\\x' + txid])
          .then(function (result) {
            if (result.rowCount === 0) {
              throw new errors.Slave.TxNotFound()
            }

            var height = result.rows[0].height
            return client.queryAsync(SQL.selectTxIdsByHeight, [height])
          })
          .then(function (result) {
            var stxids = result.rows[0].txids.toString('hex')
            var txids = []
            for (var cnt = stxids.length / 64, idx = 0; idx < cnt; idx += 1) {
              txids.push(stxids.slice(idx * 64, (idx + 1) * 64))
            }

            var merkle = []
            var hashes = txids.map(util.decode)
            var targetHash = util.decode(txid)
            while (hashes.length !== 1) {
              if (hashes.length % 2 === 1) {
                hashes.push(_.last(hashes))
              }

              var nHashes = []
              for (cnt = hashes.length, idx = 0; idx < cnt; idx += 2) {
                var nHashSrc = Buffer.concat([hashes[idx], hashes[idx + 1]])
                var nHash = bitcore.crypto.Hash.sha256sha256(nHashSrc)
                nHashes.push(nHash)

                if (bufferEqual(hashes[idx], targetHash)) {
                  merkle.push(util.encode(hashes[idx + 1]))
                  targetHash = nHash
                } else if (bufferEqual(hashes[idx + 1], targetHash)) {
                  merkle.push(util.encode(hashes[idx]))
                  targetHash = nHash
                }
              }
              hashes = nHashes
            }

            return {
              source: 'blocks',
              block: {
                height: result.rows[0].height,
                hash: result.rows[0].blockid.toString('hex'),
                merkle: merkle,
                index: txids.indexOf(txid)
              }
            }
          })
      })
  })
}

module.exports = require('soop')(DB)
