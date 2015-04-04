/* globals Promise:true */

var Promise = require('bluebird')

var errors = require('../../../../lib/errors')
var util = require('../../../../lib/util')
var master = require('../../master').default()

module.exports.latest = function (req, res) {
  res.promise(master.getLatestHeader())
}

/**
 * @param {string} val
 * @param {string} name
 * @return {(string|number})
 * @throws {errors.Slave.InvalidArguments}
 */
function convertQueryArg (val, name) {
  if (!(val === undefined || util.isSHA256Hex(val))) {
    val = parseInt(val, 10)
    if (isNaN(val)) {
      throw new errors.Slave.InvalidArguments(name + ' not number')
    }
  }

  return val
}

module.exports.query = function (req, res) {
  var result = Promise.try(function () {
    var query = {
      from: convertQueryArg(req.query.from, 'from'),
      to: convertQueryArg(req.query.to, 'to'),
      count: req.query.count
    }

    if (query.to === undefined && query.count === undefined) {
      query.count = 2016
    }

    return master.getHeaders(query)
  })

  res.promise(result)
}
