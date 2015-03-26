var _ = require('lodash')
var fs = require('fs')
var Yaml = require('js-yaml')

/**
 * @class Config
 */
function Config () {
  this._config = {}
}

/**
 * @param {string} fileName
 */
Config.prototype.load = function (fileName) {
  var config = Yaml.safeLoad(fs.readFileSync(fileName, 'utf-8'))
  _.merge(this._config, config)
  return this
}

/**
 * @param {string} name
 * @return {*}
 */
Config.prototype.get = function (name) {
  var result = name.split('.').reduce(function (obj, prop) {
    return obj === undefined ? obj : obj[prop]
  }, this._config)

  return _.cloneDeep(result)
}

/**
 * @param {string} property
 * @return {boolean}
 */
Config.prototype.has = function (property) {
  return this.get(property) !== undefined
}

module.exports = new Config()
