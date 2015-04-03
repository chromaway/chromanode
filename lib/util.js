var bitcore = require('bitcore')

var errors = require('./errors')

/**
 * @param {string} name
 * @throws {errors.InvalidNetwork}
 */
function checkNetwork (name) {
  if (bitcore.Networks.get(name) === undefined) {
    throw new errors.InvalidNetwork(name)
  }
}

/**
 * @param {*} obj
 * @param {number} size
 * @return {string}
 */
function zfill (obj, size) {
  var result = obj.toString()
  for (var count = size - result.length; count > 0; --count) {
    result = '0' + result
  }

  return result
}

module.exports = {
  checkNetwork: checkNetwork,
  zfill: zfill
}
