import _ from 'lodash'

/**
 * @class Config
 */
class Config {
  /**
   * @constructor
   */
  constructor () {
    this._config = {}
  }

  /**
   * @param {Object} config
   * @return {Config}
   */
  update (config) {
    _.merge(this._config, config)
    return this
  }

  /**
   * @param {string} name
   * @param {*} defaultValue
   * @return {*}
   */
  get (name, defaultValue) {
    return _.cloneDeep(_.get(this._config, name, defaultValue))
  }

  /**
   * @param {string} name
   * @return {boolean}
   */
  has (name) {
    let val = _.get(this._config, name)
    return val !== undefined && val !== null
  }
}

export default new Config()
