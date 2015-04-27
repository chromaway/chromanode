/* globals Promise:true */

var _ = require('lodash')
var Promise = require('bluebird')

var errors = require('../../../../lib/errors')
var SQL = require('../../sql')
var qutil = require('../util/query')

function query (req) {
  return Promise.try(function () {
    var query = {
      addresses: qutil.transformAddresses(unescape(req.query.addresses)),
      source: qutil.transformSource(req.query.source),
      from: qutil.transformFrom(req.query.from),
      to: qutil.transformTo(req.query.to),
      status: qutil.transformStatus(req.query.status)
    }

    return req.storage.executeTransaction(function (client) {
      return client.queryAsync(SQL.select.blocks.latest)
        .then(function (result) {
          var latest = result.rows[0]

          var from = query.from === undefined
                       ? -1
                       : qutil.getHeightForPoint(client, query.from)
          var to = query.to === undefined
                     ? latest.height
                     : qutil.getHeightForPoint(client, query.to)

          return Promise.all([latest, from, to])
        })
        .spread(function (latest, from, to) {
          if (from === null) {
            throw new errors.Slave.FromNotFound()
          }

          if (to === null) {
            throw new errors.Slave.ToNotFound()
          }

          var sql = query.status === 'unspent'
                      ? SQL.select.history.unspent
                      : SQL.select.history.transactions

          return Promise.all([
            latest,
            from,
            to,
            client.queryAsync(sql, [query.addresses])
          ])
        })
    })
    .spread(function (latest, from, to, results) {
      var value = []

      if (query.status === 'unspent') {
        value = results.rows.map(function (row) {
          return {
            txid: row.otxid.toString('hex'),
            vount: row.oindex,
            value: row.ovalue,
            script: row.oscript.toString('hex'),
            height: row.oheight
          }
        })
      } else {
        value = _.flatten(results.rows.map(function (row) {
          var items = [{
            txid: row.otxid.toString('hex'),
            height: row.oheight
          }]

          if (row.itxid !== null) {
            items.push({
              txid: row.itxid.toString('hex'),
              height: row.iheight
            })
          }

          return items
        }))
      }

      value = _.sortBy(value.filter(function (item) {
        if (!(item.height > from && item.height <= to)) {
          return false
        }

        if (query.source === 'blocks' && item.height === null) {
          return false
        }

        if (query.source === 'mempool' && item.height !== null) {
          return false
        }

        return true
      }), 'height')

      var ret = query.status === 'unspent'
                  ? {unspent: value}
                  : {transactions: value}
      return _.extend(ret, {
        latest: {
          height: latest.height,
          hash: latest.hash.toString('hex')
        }
      })
    })
  })
}

module.exports.v1 = {}
module.exports.v1.query = function (req, res) {
  var promise = query(req)
    .then(function (result) {
      if (result.transactions === undefined) {
        result.transactions = result.unspent.map(function (item) {
          return {txid: item.txid, height: item.height}
        })
        delete result.unspent
      }

      return result
    })

  res.promise(promise)
}

module.exports.v2 = {}
module.exports.v2.query = function (req, res) {
  res.promise(query(req))
}
