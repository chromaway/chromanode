/* globals Promise:true */

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
// var Promise = require('bluebird')
// var Peer = require('bitcore-p2p').Peer

// var config = require('../../lib/config')

/**
 * @class Network
 */
function Network () {
  EventEmitter.call(this)
}

inherits(Network, EventEmitter)

/**
 * @return {Promise}
 */
Network.prototype.init = function () {
  // var self = this

  // self.peer =
}

module.exports = Network
