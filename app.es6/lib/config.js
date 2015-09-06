import _ from 'lodash'
import fs from 'fs'
import Yaml from 'js-yaml'

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
   * @param {string} filename
   * @return {Config}
   */
  load (filename) {
    let rawConfig = fs.readFileSync(filename, 'utf-8')
    let newConfig = Yaml.safeLoad(rawConfig)
    _.merge(this._config, newConfig)
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
