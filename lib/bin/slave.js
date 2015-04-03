/* globals Promise:true */

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var Promise = require('bluebird')

/**
 * @class Slave
 * @extends EventEmitter
 */
function Slave () {
  EventEmitter.call(this)
}

inherits(Slave, EventEmitter)

/**
 * @return {Promise}
 */
Slave.prototype.init = function () {
  return Promise.resolve()
}

/**
 */
Slave.prototype.handleRequest = function () {}

module.exports = Slave
