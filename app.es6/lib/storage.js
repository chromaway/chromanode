import PUtils from 'promise-useful-utils'
import readyMixin from 'ready-mixin'

import config from './config'
import errors from './errors'
import logger from './logger'

let pg = PUtils.promisifyAll(require('pg').native)

let SQL = {
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
                    '  txid BYTEA PRIMARY KEY,' +
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
      newTxs: 'CREATE TABLE new_txs (' +
              '  id SERIAL PRIMARY KEY,' +
              '  hex BYTEA NOT NULL)'
    },
    indices: {
      blocks: {
        hash: 'CREATE INDEX ON blocks (hash)'
      },
      transactions: {
        height: 'CREATE INDEX ON transactions (height)'
      },
      history: {
        address: 'CREATE INDEX ON history (address)',
        otxid_oindex: 'CREATE INDEX ON history (otxid, oindex)',
        otxid: 'CREATE INDEX ON history (otxid)',
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
export default class Storage {
  _version = '3'

  /**
   * @constructor
   */
  constructor () {
    this._url = config.get('postgresql.url')

    pg.defaults.poolSize = config.get('postgresql.poolSize', 10)

    this._checkEnv()
      .then(() => { this._ready(null) }, (err) => { this._ready(err) })

    this.ready
      .then(() => { logger.info('Storage ready...') })
  }

  /**
   * @return {Promise}
   */
  _checkEnv (client) {
    return this.executeTransaction(async (client) => {
      let tableNames = ['info', 'blocks', 'transactions', 'history', 'new_txs']
      let result = await client.queryAsync(SQL.select.tablesCount, [tableNames])
      let count = parseInt(result.rows[0].count, 10)
      logger.info(`Found ${count} tables`)

      if (count === 0) {
        await this._createEnv(client)
      }

      if (count !== 5) {
        throw new errors.Storage.InconsistentTables()
      }

      let [version, network] = await* [
        client.queryAsync(SQL.select.info.valueByKey, ['version']),
        client.queryAsync(SQL.select.info.valueByKey, ['network'])
      ]

      // check version
      if (version.rowCount !== 1 ||
          version.rows[0].value !== this._version) {
        throw new errors.Storage.InvalidVersion(
          version.rows[0].value, this._version)
      }

      // check network
      if (network.rowCount !== 1 ||
          network.rows[0].value !== config.get('chromanode.network')) {
        throw new errors.Storage.InvalidNetwork(
          network.rows[0].value, config.get('chromanode.network'))
      }
    })
  }

  /**
   * @param {pg.Client} client
   * @return {Promise}
   */
  async _createEnv (client) {
    logger.info('Creating db tables...')
    await* [
      client.queryAsync(SQL.create.tables.info),
      client.queryAsync(SQL.create.tables.blocks),
      client.queryAsync(SQL.create.tables.transactions),
      client.queryAsync(SQL.create.tables.history),
      client.queryAsync(SQL.create.tables.newTxs)
    ]

    logger.info('Creating db indices...')
    await* [
      client.queryAsync(SQL.create.indices.blocks.hash),
      client.queryAsync(SQL.create.indices.transactions.height),
      client.queryAsync(SQL.create.indices.history.address),
      client.queryAsync(SQL.create.indices.history.otxid_oindex),
      client.queryAsync(SQL.create.indices.history.oheight),
      client.queryAsync(SQL.create.indices.history.itxid),
      client.queryAsync(SQL.create.indices.history.iheight)
    ]

    logger.info('Insert version and network to info...')

    let version = this._version
    let network = config.get('chromanode.network')

    await* [
      client.queryAsync(SQL.insert.info.row, ['version', version]),
      client.queryAsync(SQL.insert.info.row, ['network', network])
    ]
  }

  /**
   * @param {function} fn
   * @return {Promise}
   */
  async execute (fn) {
    let [client, done] = await pg.connectAsync(this._url)
    try {
      let result = await fn(client)
      done()
      return result
    } catch (err) {
      client.end()
      throw err
    }
  }

  /**
   * @param {string} query
   * @param {Array.<*>} [params]
   * @return {Promise}
   */
  executeQuery (query, params) {
    return this.execute((client) => {
      return client.queryAsync(query, params)
    })
  }

  /**
   * @param {function} fn
   * @return {Promise}
   */
  executeTransaction (fn) {
    return this.execute(async (client) => {
      await client.queryAsync('BEGIN')
      try {
        var result = await fn(client)
      } catch (err) {
        await client.queryAsync('ROLLBACK')
        throw err
      }

      await client.queryAsync('COMMIT')
      return result
    })
  }
}

readyMixin(Storage.prototype)
