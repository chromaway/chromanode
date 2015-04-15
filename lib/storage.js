/* globals Promise:true */

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
               '  iindex INTEGER,' +
               '  iheight INTEGER)'
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
        itxid_iindex: 'CREATE INDEX ON history (itxid, iindex)',
        iheight: 'CREATE INDEX ON history (iheight)'
      }
    }
  },
  insert: {
    toInfo: 'INSERT INTO info (key, value) VALUES ($1, $2)'
  },
  select: {
    tablesCount: 'SELECT COUNT(*) ' +
                 '  FROM information_schema.tables' +
                 '  WHERE table_name = ANY($1)',

    valueByKey: 'SELECT value FROM info WHERE key = $1'
  }
}

/**
 * @class Storage
 */
function Storage () {
  this._version = '3'
  this._url = config.get('postgresql.url')
  pg.defaults.poolSize = config.get('postgresql.poolSize') || 10
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
  var version = this._version
  var network = config.get('chromanode.network')

  function executeQueries (queries) {
    return Promise.map(queries, function (query) {
      return client.queryAsync(query)
    })
  }

  return Promise.try(function () {
    logger.info('Creating db tables...')
    return executeQueries([
      SQL.create.tables.info,
      SQL.create.tables.blocks,
      SQL.create.tables.transactions,
      SQL.create.tables.history
    ])
  })
  .then(function () {
    logger.info('Creating db indices...')
    return executeQueries([
      SQL.create.indices.blocks.hash,
      SQL.create.indices.transactions.txid,
      SQL.create.indices.transactions.height,
      SQL.create.indices.history.address,
      SQL.create.indices.history.otxid_oindex,
      SQL.create.indices.history.oheight,
      SQL.create.indices.history.itxid_iindex,
      SQL.create.indices.history.iheight
    ])
  })
  .then(function () {
    logger.info('Insert version and network to info...')
    return Promise.all([
      client.queryAsync(SQL.insert.toInfo, ['version', version]),
      client.queryAsync(SQL.insert.toInfo, ['network', network])
    ])
  })
}

/**
 * @return {Promise}
 */
Storage.prototype.init = function () {
  var self = this
  return self.executeTransaction(function (client) {
    var tableNames = ['info', 'blocks', 'transactions', 'history']
    return client.queryAsync(SQL.select.tablesCount, [tableNames])
      .then(function (result) {
        var count = parseInt(result.rows[0].count, 10)

        if (count > 0 && count !== 4) {
          throw new errors.Storage.InconsistentTables()
        }

        if (count === 0) {
          return self._createEnv(client)
        }
      })
      .then(function () {
        return Promise.all([
          client.queryAsync(SQL.select.valueByKey, ['version']),
          client.queryAsync(SQL.select.valueByKey, ['network'])
        ])
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
  .then(function () {
    logger.info('Storage ready...')
  })
}

module.exports = require('soop')(Storage)
