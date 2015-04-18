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
  this.status = {
    version: util.getVersion(),
    network: config.get('chromanode.network'),
    status: 'starting',
    progress: null,
    latest: {
      hash: null,
      height: null
    },
    blockchainLatest: {
      hash: null,
      height: null
    },
    connections: 0,
    bitcoind: {
      version: null,
      protocolversion: null,
      errors: null
    }
  }
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
    // sendtx handler
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

    // get some info for status
    return self.network.getBitcoindVersion()
  })
  .then(function (bitcoindVersion) {
    // fill status.bitcoind
    self.status.bitcoind.version = bitcoindVersion.version
    self.status.bitcoind.protocolversion = bitcoindVersion.protocolversion

    // update status.connections and broadcast
    var updateStatusConnections = _.debounce(function () {
      self.network.getConnectedNumber()
        .then(function (count) {
          if (self.status.connections !== count) {
            self.status.connections = count
            self.slaves.broadcastStatus(self.status)
          }
        })
    }, 1000)
    self.network.on('peerconnect', updateStatusConnections)
    self.network.on('peerdisconnect', updateStatusConnections)

    // update status.bitcoind.errors and broadcast
    self.network.on('newBitcoindError', function (err) {
      self.status.bitcoind.errors = err
      self.slaves.broadcastStatus(self.status)
    })

    // historySync start handler
    var historySyncOnStart = function () {
      self.status.status = 'syncing'
      self.slaves.broadcastStatus(self.status)
    }
    self.historySync.on('start', historySyncOnStart)

    // historySync progress handler
    var historySyncOnProgress = function () {
      var info = self.historySync.getInfo()
      self.status.progress = info.progress
      self.status.latest = _.clone(info.latest)
      self.status.blockchainLatest = _.clone(info.blockchainLatest)
      self.slaves.broadcastStatus(self.status)
    }
    self.historySync.on('progress', historySyncOnProgress)

    self.historySync.on('finish', function () {
      self.historySync.removeListener('start', historySyncOnStart)
      self.historySync.removeListener('progress', historySyncOnProgress)

      self.status.status = 'finished'
      self.slaves.broadcastStatus(self.status)

      // also add peerSync listeners, move to function?
      // self.peerSync.run()
    })

    // update progress, latest, blockchainLatest and broadcast status
    historySyncOnProgress()

    // run historySync
    timers.setImmediate(function () { self.historySync.run() })
  })
}

/**
 * @return {Promise}
 */
module.exports.run = function () {
  var master = new Master()
  return master.init()
}
