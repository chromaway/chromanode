/* globals Promise:true */

var Promise = require('bluebird')

var db = require('../../db').default()
var util = require('../../../../lib/util')

module.exports.status = function (req, res) {
  /* @todo */
  var result = Promise.all([
    db.getLatestHeader()
  ])
  .spread(function (header) {
    return {
      bitcoind: {},
      chromanode: {
        latest: header,
        version: util.getVersion()
      }
    }
  })

  res.promise(result)
}
