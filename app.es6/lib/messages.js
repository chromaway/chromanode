import _ from 'lodash'
import { EventEmitter } from 'events'
import PUtils from 'promise-useful-utils'
import { mixin } from 'core-decorators'
import ReadyMixin from 'ready-mixin'

import logger from './logger'

/**
 * @class Messages
 */
@mixin(ReadyMixin)
export default class Messages {
  /**
   * @constructor
   * @param {Object} opts
   * @param {Storage} opts.storage
   */
  constructor (opts) {
    this._storage = opts.storage

    this._events = new EventEmitter()
    this._listener = null

    PUtils.try(async () => {
      await this._storage.ready
      await this._createNewListener()
    })
    .then(() => this._ready(null), (err) => this._ready(err))

    this.ready
      .then(() => logger.info('Messages ready ...'))
  }

  /**
   * @return {Promise}
   */
  _createNewListener () {
    logger.info('Getting storage client for notification...')

    return new Promise((resolve, reject) => {
      this._storage.execute((client) => {
        this._listener = client

        // emit msg to _events
        this._listener.on('notification', (msg) => {
          this._events.emit(msg.channel, JSON.parse(msg.payload))
        })

        // re-create on error
        this._listener.on('error', async (err) => {
          logger.error(`Storage._listener: ${err.stack}`)
          this._listener.removeAllListeners()
          while (true) {
            try {
              await this._createNewListener()
              break
            } catch (err) {
              logger.error(`Storag._createNewListen: ${err.stack}`)
              await PUtils.delay(1000)
            }
          }
        })

        // hack for getting all channels
        Promise.all(Object.keys(this._events._events).map((channel) => {
          return this._listener.queryAsync(`LISTEN ${channel}`)
        }))
        .then(resolve, reject)

        // holding client
        return new Promise(_.noop)
      })
      .catch(reject)
    })
  }

  /**
   * @param {string} channel
   * @param {function} listener
   * @return {Promise}
   */
  async listen (channel, listener) {
    await this._listener.queryAsync(`LISTEN ${channel}`)
    this._events.on(channel, listener)
  }

  /**
   * @param {string} channel
   * @param {string} payload
   * @param {Object} [opts]
   * @param {pg.Client} [opts.client]
   * @return {Promise}
   */
  async notify (channel, payload, opts) {
    let execute = ::this._storage.executeTransaction
    if (_.has(opts, 'client')) {
      execute = async (fn) => fn(opts.client)
    }

    await execute((client) => {
      return client.queryAsync("SELECT pg_notify($1, $2)", [channel, JSON.stringify(payload)])
    })
  }
}
