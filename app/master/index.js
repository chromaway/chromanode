/* globals Promise:true */

var _ = require('lodash')
var timers = require('timers')
var Promise = require('bluebird')

var config = require('../../lib/config')
// var logger = require('../../lib/logger').logger
var Storage = require('../../lib/storage')
var util = require('../../lib/util')
var Network = require('./network')
var Slaves = require('./slaves')
var HistorySync = require('./sync/history')
var PeerSync = require('./sync/peer')

/**
 * @class Master
 */
function Master () {
  var self = this

  self.status = {
    version: util.getVersion(),
    network: config.get('chromanode.network'),
    progress: null,
    latest: {
      hash: null,
      height: null
    },
    bitcoind: {
      version: null,
      protocolversion: null,
      connections: 0,
      errors: null,
      latest: {
        hash: null,
        height: null
      }
    }
  }

  self.broadcastStatus = function () {}
}

/**
 * @return {Promise}
 */
Master.prototype.init = function () {
  var self = this

  self.storage = new Storage()
  self.network = new Network()
  self.slaves = new Slaves(self.storage)
  self.historySync = new HistorySync(self.storage, self.network)
  self.peerSync = new PeerSync(self.storage, self.network)

  return Promise.all([
    self.storage.init(),
    self.network.init()
  ])
  .then(function () {
    return Promise.all([
      self.slaves.init(),
      self.historySync.init(),
      self.peerSync.init()
    ])
  })
  .then(function () {
    return Promise.all([
      self._installSendTxHandler(),
      self._installBitcoindHandlers()
    ])
  })
  .then(function () {
    self.broadcastStatus = _.debounce(function () {
      self.slaves.broadcastStatus(self.status)
    }, 500)

    // historySync progress handler
    var historySyncOnProgress = function (progress, latest) {
      self.status.progress = progress
      self.status.latest = latest
      self.broadcastStatus()
    }
    self.historySync.on('progress', historySyncOnProgress)

    // remove historySync handlers on finish
    self.historySync.on('finish', function () {
      self.historySync.removeListener('progress', historySyncOnProgress)

      // also add peerSync listeners, move to function?
      // self.peerSync.run()
    })

    // run historySync
    timers.setImmediate(function () { self.historySync.run() })
  })
}

/**
 */
Master.prototype._installSendTxHandler = function () {
  var self = this
  self.slaves.on('sendTx', function (id, rawtx) {
    self.network.sendTx(rawtx)
      .then(function () { return })
      .catch(function (err) {
        if (err instanceof Error) {
          return {code: null, message: err.message}
        }

        return err
      })
      .then(function (ret) {
        self.slaves.sendTxResponse(id, ret)
      })
  })
}

/**
 * @return {Promise}
 */
Master.prototype._installBitcoindHandlers = function () {
  var self = this

  var updateBitcoindInfo = function (info) {
    return self.network.getBitcoindInfo()
      .then(function (info) {
        var old = self.status.bitcoind
        var shouldBroadcast = old.version !== info.version ||
                              old.protocolversion !== info.protocolversion ||
                              old.connections !== info.connections ||
                              old.errors !== info.errors

        if (shouldBroadcast) {
          self.status.bitcoind.version = info.version
          self.status.bitcoind.protocolversion = info.protocolversion
          self.status.connections = info.connections
          self.status.errors = info.errors
          self.broadcastStatus()
        }
      })
      .finally(function () {
        setTimeout(updateBitcoindInfo, 5000)
      })
  }

  var onNewBlock = util.makeCuncurrent(function () {
    return self.network.getLatest()
      .then(function (latest) {
        if (self.status.bitcoind.latest.hash !== latest.hash) {
          self.status.bitcoind.latest = latest
          self.broadcastStatus()
        }
      })
  }, {concurrency: 1})
  self.network.on('block', onNewBlock)

  return Promise.all([
    updateBitcoindInfo(),
    onNewBlock()
  ])
}

/**
 * @return {Promise}
 */
module.exports.run = function () {
  var master = new Master()
  return master.init()
}
