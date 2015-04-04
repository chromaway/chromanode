/* globals Promise:true */

var Promise = require('bluebird')

var master = require('../../master').default()
var util = require('../../../../lib/util')

module.exports.status = function (req, res) {
  /* @todo */
  var result = Promise.all([
    master.getLatestHeader()
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
