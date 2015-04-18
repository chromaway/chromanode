/* globals Promise:true */

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var Promise = require('bluebird')

/**
 * @class PeerSync
 * @param {Storage} storage
 * @param {Network} network
 */
function PeerSync (storage, network) {
  EventEmitter.call(this)

  this.storage = storage
  this.network = network
}

inherits(PeerSync, EventEmitter)

/**
 * @return {Promise}
 */
PeerSync.prototype.init = function () {
  return Promise.resolve()
}

/**
 */
PeerSync.prototype.run = function () {}

module.exports = PeerSync
