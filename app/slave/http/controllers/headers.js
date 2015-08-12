'use strict'

var _ = require('lodash')
var Promise = require('bluebird')

var errors = require('../../../../lib/errors')
var SQL = require('../../sql')
var qutil = require('../util/query')

module.exports.v1 = {}
module.exports.v2 = {}

function latest (req) {
  return req.storage.executeQuery(SQL.select.blocks.latest)
    .then(function (result) {
      var row = result.rows[0]
      return {
        height: row.height,
        hash: row.hash.toString('hex'),
        header: row.header.toString('hex')
      }
    })
}

module.exports.v1.latest = function (req, res) {
  var promise = latest(req)
    .then(function (result) {
      result.blockid = result.hash
      delete result.hash
      return result
    })

  res.promise(promise)
}

module.exports.v2.latest = function (req, res) {
  res.promise(latest(req))
}

function query (req, res, shift) {
  var result = Promise.try(function () {
    var query = {
      from: qutil.transformFrom(req.query.from),
      to: qutil.transformTo(req.query.to),
      count: qutil.transformCount(req.query.count) || 2016
    }

    return req.storage.executeTransaction(function (client) {
      return Promise.try(function () {
        if (query.from === undefined) {
          return -1
        }

        return qutil.getHeightForPoint(client, query.from)
      })
      .then(function (from) {
        if (from === null) {
          throw new errors.Slave.FromNotFound()
        }

        if (query.to === undefined) {
          return [from, from + query.count]
        }

        return qutil.getHeightForPoint(client, query.to)
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

        var params = [from + shift, to + shift]
        return Promise.all([
          from,
          client.queryAsync(SQL.select.blocks.headers, params)
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
  })

  res.promise(result)
}

module.exports.v1.query = function (req, res) { query(req, res, -1) }
module.exports.v2.query = function (req, res) { query(req, res, 0) }
