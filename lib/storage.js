'use strict'

var _ = require('lodash')
var events = require('events')
var Promise = require('bluebird')
var pg = Promise.promisifyAll(require('pg').native)

var config = require('./config')
var errors = require('./errors')
var logger = require('./logger').logger

var SQL = {
  create: {
    tables: {
      info: 'CREATE TABLE info (' +
            '  key CHAR(100) PRIMARY KEY,' +
            '  value TEXT NOT NULL)',

      blocks: 'CREATE TABLE blocks (' +
              '  height INTEGER PRIMARY KEY,' +
              '  hash BYTEA NOT NULL,' +
              '  header BYTEA NOT NULL,' +
              '  txids BYTEA NOT NULL)',

      transactions: 'CREATE TABLE transactions (' +
                    '  txid BYTEA NOT NULL,' +
                    '  height INTEGER,' +
                    '  tx BYTEA NOT NULL)',

      history: 'CREATE TABLE history (' +
               '  address BYTEA,' +
               '  otxid BYTEA,' +
               '  oindex INTEGER,' +
               '  ovalue BIGINT,' +
               '  oscript BYTEA,' +
               '  oheight INTEGER,' +
               '  itxid BYTEA,' +
               '  iheight INTEGER)',
      new_txs: 'CREATE TABLE new_txs (' +
               'id SERIAL,' +
               'hex TEXT NOT NULL)'
    },
    indices: {
      blocks: {
        hash: 'CREATE INDEX ON blocks (hash)'
      },
      transactions: {
        txid: 'CREATE INDEX ON transactions (txid)',
        height: 'CREATE INDEX ON transactions (height)'
      },
      history: {
        address: 'CREATE INDEX ON history (address)',
        otxid_oindex: 'CREATE INDEX ON history (otxid, oindex)',
        oheight: 'CREATE INDEX ON history (oheight)',
        itxid: 'CREATE INDEX ON history (itxid)',
        iheight: 'CREATE INDEX ON history (iheight)'
      }
    }
  },
  insert: {
    info: {
      row: 'INSERT INTO info (key, value) VALUES ($1, $2)'
    }
  },
  select: {
    tablesCount: 'SELECT COUNT(*) ' +
                 '  FROM information_schema.tables ' +
                 '  WHERE ' +
                 '    table_name = ANY($1)',

    info: {
      valueByKey: 'SELECT value FROM info WHERE key = $1'
    }
  }
}

/**
 * @class Storage
 */
function Storage () {
  this._version = '3'
  this._url = config.get('postgresql.url')
  this._ee = new events.EventEmitter()
}

/**
 * @param {function} fn
 * @return {Promise}
 */
Storage.prototype.execute = function (fn) {
  return pg.connectAsync(this._url).spread(function (client, done) {
    return fn(client)
      .then(function (ret) {
        done()
        return ret

      }, function (err) {
        client.end()
        throw err

      })
  })
}

/**
 * @param {string} query
 * @param {Array.<*>} [params]
 * @return {Promise}
 */
Storage.prototype.executeQuery = function (query, params) {
  return this.execute(function (client) {
    return client.queryAsync(query, params)
  })
}

/**
 * @param {} queries
 * @param {Object} [opts]
 * @param {pg.Client} [opts.client]
 * @param {number} [opts.concurrency=0]
 * @return {Promise}
 */
Storage.prototype.executeQueries = function (queries, opts) {
  var concurrency = _.isObject(opts) ? opts.concurrency : 0

  var runNotify = this.executeTransaction.bind(this)
  if (_.has(opts, 'client')) {
    runNotify = function (fn) {
      return Promise.try(function () { return fn(opts.client) })
    }
  }

  return runNotify(function (client) {
    return Promise.map(queries, function (args) {
      return client.queryAsync.apply(client, args)
    }, {concurrency: concurrency})
  })
}

/**
 * @param {function} fn
 * @return {Promise}
 */
Storage.prototype.executeTransaction = function (fn) {
  return this.execute(function (client) {
    return client.queryAsync('BEGIN')
      .then(function () { return fn(client) })
      .then(function (ret) {
        return client.queryAsync('COMMIT').then(function () { return ret })

      }, function (err) {
        return client.queryAsync('ROLLBACK').then(function () { throw err })

      })
  })
}

/**
 * @param {pg.Client} client
 * @return {Promise}
 */
Storage.prototype._createEnv = function (client) {
  var self = this

  return Promise.try(function () {
    logger.info('Creating db tables...')
    return self.executeQueries([
      [SQL.create.tables.info],
      [SQL.create.tables.blocks],
      [SQL.create.tables.transactions],
      [SQL.create.tables.history],
      [SQL.create.tables.new_txs]
    ], {client: client})
  })
  .then(function () {
    logger.info('Creating db indices...')
    return self.executeQueries([
      [SQL.create.indices.blocks.hash],
      [SQL.create.indices.transactions.txid],
      [SQL.create.indices.transactions.height],
      [SQL.create.indices.history.address],
      [SQL.create.indices.history.otxid_oindex],
      [SQL.create.indices.history.oheight],
      [SQL.create.indices.history.itxid_iheight],
      [SQL.create.indices.history.iheight]
    ], {client: client})
  })
  .then(function () {
    logger.info('Insert version and network to info...')

    var version = self._version
    var network = config.get('chromanode.network')

    return self.executeQueries([
      [SQL.insert.info.row, ['version', version]],
      [SQL.insert.info.row, ['network', network]]
    ], {client: client})
  })
}

/**
 * @return {Promise}
 */
Storage.prototype._checkEnv = function (client) {
  var self = this
  return self.executeTransaction(function (client) {
    var tableNames = ['info', 'blocks', 'transactions', 'history', 'new_txs']
    return client.queryAsync(SQL.select.tablesCount, [tableNames])
      .then(function (result) {
        var count = parseInt(result.rows[0].count, 10)

        console.log(count)
        if (count > 0 && count !== 5) {
          throw new errors.Storage.InconsistentTables()
        }

        if (count === 0) {
          return self._createEnv(client)
        }
      })
      .then(function () {
        return self.executeQueries([
          [SQL.select.info.valueByKey, ['version']],
          [SQL.select.info.valueByKey, ['network']]
        ], {client: client})
      })
      .spread(function (version, network) {
        // check version
        if (version.rowCount !== 1 ||
            version.rows[0].value !== self._version) {
          throw new errors.Storage.InvalidVersion(
            version.rows[0].value, self._version)
        }

        // check network
        if (network.rowCount !== 1 ||
            network.rows[0].value !== config.get('chromanode.network')) {
          throw new errors.Storage.InvalidNetwork(
            network.rows[0].value, config.get('chromanode.network'))
        }
      })
  })
}

/**
 * @return {Promise}
 */
Storage.prototype._createNewListener = function () {
  logger.info('Getting storage client for notification...')

  var self = this
  return new Promise(function (resolve, reject) {
    self.execute(function (client) {
      self._listener = client

      // emit msg to _ee
      self._listener.on('notification', function (msg) {
        self._ee.emit(msg.channel, msg.payload)
      })

      // re-create on error
      self._listener.on('error', function (err) {
        logger.error('Storage._listener: ', err)
        self._listener.removeAllListeners()
        self._createNewListener()
      })

      // hack for getting all channels
      Promise.map(_.keys(self._ee._events), function (channel) {
        return self._listener.queryAsync('LISTEN ' + channel)
      })
      .done(resolve, reject)

      // holding client
      return new Promise(function () {})
    })
    .catch(reject)
  })
}

/**
 * @return {Promise}
 */
Storage.prototype.init = function () {
  pg.defaults.poolSize = config.get('postgresql.poolSize') || 10

  return Promise.all([
    this._checkEnv(),
    this._createNewListener()
  ])
  .then(function () {
    logger.info('Storage ready...')
  })
}

/**
 * @param {string} channel
 * @param {string} payload
 * @param {Objects} [opts]
 * @param {pg.Client} [opts.client]
 * @return {Promise}
 */
Storage.prototype.notify = function (channel, payload, opts) {
  var runNotify = this.execute.bind(this)
  if (_.has(opts, 'client')) {
    runNotify = function (fn) {
      return Promise.try(function () { return fn(opts.client) })
    }
  }

  return runNotify(function (client) {
    return client.queryAsync('NOTIFY ' + channel + ', \'' + payload + '\'')
  })
}

/**
 * @param {string} channel
 * @param {function} listener
 * @param {Promise}
 */
Storage.prototype.listen = function (channel, listener) {
  var self = this
  return self._listener.queryAsync('LISTEN ' + channel)
    .then(function () { self._ee.on(channel, listener) })
}

module.exports = Storage
