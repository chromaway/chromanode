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
 * @return {string}
 */
function getVersion () {
  return require('../package.json').version
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

/**
 * @param {string} s
 * @return {Buffer}
 */
function decode (s) {
  return Array.prototype.reverse.call(new Buffer(s, 'hex'))
}

/**
 * @param {Buffer} s
 * @return {string}
 */
function encode (s) {
  return Array.prototype.reverse.call(new Buffer(s)).toString('hex')
}

/**
 * @param {number} value
 * @return {string}
 */
function stopwatchFormat (value) {
  if (value < 1e3) {
    return value + 'ns'
  }

  if (value < 1e6) {
    return (value / 1e3).toFixed(3) + 'us'
  }

  if (value < 1e9) {
    return (value / 1e6).toFixed(3) + 'ms'
  }

  return (value / 1e9).toFixed(3) + 's'
}

/**
 * @return {Object}
 */
function stopwatchStart () {
  var time
  var obj = {
    value: function () {
      var diff = process.hrtime(time)
      return diff[0] * 1e9 + diff[1]
    },
    format: stopwatchFormat
  }

  time = process.hrtime()
  return obj
}

module.exports = {
  checkNetwork: checkNetwork,
  getVersion: getVersion,
  zfill: zfill,
  decode: decode,
  encode: encode,
  stopwatch: {start: stopwatchStart, format: stopwatchFormat}
}
