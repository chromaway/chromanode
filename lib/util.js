'use strict'

var _ = require('lodash')
var bitcore = require('bitcore')
var Promise = require('bluebird')

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

  function getValue () {
    var diff = process.hrtime(time)
    return diff[0] * 1e9 + diff[1]
  }

  var obj = {
    value: getValue,
    formattedValue: function () {
      return stopwatchFormat(getValue())
    }
  }

  time = process.hrtime()
  return obj
}

/**
 * @param {function} fn
 * @param {Object} [opts]
 * @param {number} [opts.concurrency=1]
 * @return {function}
 */
function makeConcurrent (fn, opts) {
  var concurrency = opts && opts.concurrency >= 0
                      ? opts.concurrency
                      : 1

  var queue = []
  var launched = 0

  function queuePulse () {
    if ((concurrency === 0 || launched < concurrency) &&
        (queue.length > 0 && queue.length > launched)) {
      queue[launched].resolve()
      launched += 1
    }
  }

  return function () {
    var ctx = this
    var args = _.slice(arguments)

    var deferred = Promise.defer()
    queue.push(deferred)
    queuePulse()

    return deferred.promise
      .then(function () { return fn.apply(ctx, args) })
      .finally(function () {
        launched -= 1
        queue.splice(queue.indexOf(deferred), 1)
        queuePulse()
      })
  }
}

module.exports = {
  ZERO_HASH: '0000000000000000000000000000000000000000000000000000000000000000',

  checkNetwork: checkNetwork,
  getVersion: getVersion,
  decode: decode,
  encode: encode,
  stopwatch: {start: stopwatchStart, format: stopwatchFormat},
  makeConcurrent: makeConcurrent
}
