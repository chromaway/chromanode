var bitcore = require('bitcore')
var isHexa = bitcore.util.js.isHexa

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
 * @return {string}
 */
function getVersion () {
  return require('../package.json').version
}

/**
 * @param {string} value
 * @return {boolean}
 */
function isSHA256Hex (value) {
  return value.length === 64 && isHexa(value)
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
  getVersion: getVersion,
  isSHA256Hex: isSHA256Hex,
  zfill: zfill
}
