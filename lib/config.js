var _ = require('lodash')
var fs = require('fs')
var Yaml = require('js-yaml')

/**
 * @param {Object} obj
 * @param {string} name
 * @return {*}
 */
function getProp (obj, name) {
  return name.split('.').reduce(function (obj, prop) {
    return obj === undefined ? obj : obj[prop]
  }, obj)
}

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
  return _.cloneDeep(getProp(this._config, name))
}

/**
 * @param {string} name
 * @return {boolean}
 */
Config.prototype.has = function (name) {
  return getProp(this._config, name) !== undefined
}

module.exports = new Config()
