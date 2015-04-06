/* globals Promise:true */

var _ = require('lodash')
var Promise = require('bluebird')

var errors = require('../../lib/errors')
var storage = require('../../lib/storage').default()

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
                        '  WHERE address = ANY($1)'
}

function convertToAnyParam (arr) {
  return '{"' + arr.join('","') + '"}'
}

/**
 * @class Master
 */
function Master () {}

/**
 * @return {Promise<{height: number, blockid: string, header: string}>}
 */
Master.prototype.getLatestHeader = function () {
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
Master.prototype._getHeightForPoint = function (client, point) {
  var args = _.isNumber(point)
               ? [SQL.selectHeightByHeight, [point]]
               : [SQL.selectHeightByBlockId, ['\\x' + point]]

  return client.queryAsync.apply(client, args)
    .then(function (result) {
      if (result.rows.length === 0) {
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
Master.prototype.headersQuery = function (query) {
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
            if (to === 0) {
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
 * @typedef Master~AddressesQueryResult
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
 * @return {Promise<Master~AddressesQueryResult}
 */
Master.prototype.addressesQuery = function (query) {
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
          row.height = _.isNumber(row.height) ? row.height : null
          return row
        })

        if (query.status === 'unspent') {
          /* @todo */
        }

        var transactions = _.chain(history)
          .map(function (item) {
            return {txid: item.txid, height: item.height}
          })
          .uniq(function (item) {
            return item.txid + item.height
          })
          .value()

        return {
          transactions: transactions,
          latest: {
            height: latest.height,
            blockid: latest.blockid.toString('hex')
          }
        }
      })
  })
}

module.exports = require('soop')(Master)
