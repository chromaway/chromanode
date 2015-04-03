var express = require('express')

module.exports.setup = function () {
  express.response.jsend = function (data) {
    this.jsonp({status: 'success', data: data})
  }

  express.response.jfail = function (data) {
    this.jsonp({status: 'fail', data: data})
  }

  express.response.jerror = function (message, code) {
    this.jsonp({status: 'error', message: message, code: code})
  }
}
