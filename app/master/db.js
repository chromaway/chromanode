/* globals Promise:true */

var Promise = require('bluebird')

var storage = require('../../lib/storage').default()
var util = require('../../lib/util')

/**
 * @class DB
 */
function DB () {}

/**
 * @return {Promise<{height: number, blockid: string}>}
 */
DB.prototype.getLatest = function () {
  var query = 'SELECT ' +
              '  height as height, ' +
              '  blockid as blockid ' +
              'FROM blocks ' +
              '  ORDER BY height DESC ' +
              '  LIMIT 1'

  return storage.execute(function (client) {
    return client.queryAsync(query)
      .then(function (result) {
        if (result.rows.length === 0) {
          return {height: -1, blockid: util.zfill('', 64)}
        }

        var row = result.rows[0]
        return {height: row.height, blockid: row.blockid.toString('hex')}
      })
  })
}

module.exports = require('soop')(DB)
