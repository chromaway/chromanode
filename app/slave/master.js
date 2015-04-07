/* globals Promise:true */

var Promise = require('bluebird')

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits

var messages = require('../../lib/messages').default()

/**
 * @event Master#newBlock
 * @param {string} blockid
 * @param {number} height
 */

/**
 * @event Master#addressTouched
 * @param {string} address
 * @param {string} txid
 */

/**
 * @class Master
 */
function Master () {
  EventEmitter.call(this)
}

inherits(Master, EventEmitter)

/**
 * @return {Promise}
 */
Master.prototype.init = function () {
  var self = this

  function onNewBlock (payload) {
    payload = JSON.parse(payload)
    self.emit('newBlock', payload.blockid, payload.height)
  }

  function onAddressTouched (payload) {
    payload = JSON.parse(payload)
    self.emit('addressTouched', payload.address, payload.txid)
  }

  return Promise.all([
    messages.listen('newblock', onNewBlock),
    messages.listen('addresstouched', onAddressTouched)
  ])
}

module.exports = require('soop')(Master)
