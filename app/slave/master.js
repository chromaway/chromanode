/* globals Promise:true */

var _ = require('lodash')
var Promise = require('bluebird')

var errors = require('../../lib/errors')
var storage = require('../../lib/storage').default()

/**
 * @class Master
 */
function Master () {}

/**
 * @return {Promise<{height: number, blockid: string, header: string}>}
 */
Master.prototype.getLatestHeader = function () {
  var query = 'SELECT ' +
              '  height as height, blockid as blockid, header as header ' +
              'FROM blocks ' +
              '  ORDER BY height DESC ' +
              '  LIMIT 1'

  return storage.execute(function (client) {
    return client.queryAsync(query)
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
 * @param {Object} headersQuery
 * @param {number} headersQuery.from
 * @param {number} [headersQuery.to]
 * @param {string} [headersQuery.count]
 * @return {Promise<{from: number, count: number, headers: string}>}
 */
Master.prototype.headersQuery = function (query) {
  var SQL = {
    getHeightByHeight: 'SELECT ' +
                       '  height as height ' +
                       'FROM blocks ' +
                       '  WHERE height = $1',
    getHeightByBlockId: 'SELECT ' +
                        '  height as height ' +
                        'FROM blocks ' +
                        '  WHERE blockid = $1',
    getHeaders: 'SELECT ' +
                '  header as header ' +
                'FROM blocks ' +
                '  WHERE height >= $1 AND height < $2'
  }

  function toArgs (param) {
    if (_.isNumber(param)) {
      return [SQL.getHeightByHeight, [param]]
    }

    return [SQL.getHeightByBlockId, ['\\x' + param]]
  }

  return storage.executeTransaction(function (client) {
    return client.queryAsync.apply(client, toArgs(query.from))
      .then(function (result) {
        if (result.rows.length === 0) {
          var msg = 'from ' + query.from + ' not found'
          throw new errors.Slave.InvalidArguments(msg)
        }

        var from = result.rows[0].height

        if (query.to === undefined) {
          return [from, from + query.count]
        }

        return client.queryAsync.apply(client, toArgs(query.to))
          .then(function (result) {
            if (result.rows.length === 0) {
              var msg = 'to ' + query.to + ' not found'
              throw new errors.Slave.InvalidArguments(msg)
            }

            return [from, result.rows[0].height]
          })
      })
      .spread(function (from, to) {
        var count = to - from
        if (count <= 0 || count > 2016) {
          var msg = count > 2016
                      ? 'requested too many headers'
                      : 'requested wrong count of headers'
          throw new errors.Slave.InvalidArguments(msg)
        }

        return Promise.all([
          from,
          client.queryAsync(SQL.getHeaders, [from, to])
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
  return storage.executeTransaction(function (client) {

  })
}

module.exports = require('soop')(Master)
