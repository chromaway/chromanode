/* globals Promise:true */

var Promise = require('bluebird')

var EventEmitter = require('events').EventEmitter

/**
 * @class Messages
 */
function Messages () {
  this.events = new EventEmitter()
}

/**
 * @return {Promise}
 */
Messages.prototype.init = function () {
  var self = this
  var storage = require('./storage').default()
  return new Promise(function (resolve, reject) {
    storage.execute(function (client) {
      // emit msg for channel
      client.on('notification', function (msg) {
        self.events.emit(msg.channel, msg.payload)
      })

      self.client = client
      resolve()

      // hold this client forever
      return Promise.defer().promise
    })
    .catch(reject)
  })
}

/**
 * @param {pg.Client} client
 * @param {string} channel
 * @param {string} payload
 * @return {Promise}
 */
Messages.prototype.notify = function (client, channel, payload) {
  return client.queryAsync('NOTIFY ' + channel + ', \'' + payload + '\'')
}

/**
 * @param {string} channel
 * @param {string} listener
 * @param {Promise}
 */
Messages.prototype.listen = function (channel, listener) {
  var self = this
  return self.client.queryAsync('LISTEN ' + channel)
    .then(function (res) {
      self.events.on(channel, listener)
      return res
    })
}

module.exports = require('soop')(Messages)
