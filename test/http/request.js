import _ from 'lodash'
import { extend as extendError } from 'error-system'
import urlJoin from 'url-join'
import PUtils from 'promise-useful-utils'

let request = PUtils.promisify(require('request'))

/**
 * Error
 *  +-- RequestError
 *       +-- StatusFail
 *       +-- StatusError
 *       +-- StatusUnknow
 */
let errorSpec = {
  name: 'RequestError',
  message: 'InternalError',
  errors: [{
    name: 'StatusFail',
    message: 'Response with fail status (uri: {uri})'
  }, {
    name: 'StatusError',
    message: 'Response with error status (uri: {uri})'
  }, {
    name: 'StatusUnknow',
    message: 'Response with unknow status (uri: {uri})'
  }]
}
extendError(Error, errorSpec)

export default function (testsOpts) {
  async function customRequest (method, path, data) {
    var requestOpts = {
      method: 'GET',
      uri: urlJoin(`http://127.0.0.1:${testsOpts.ports.slave}`, path),
      timeout: 5000,
      json: true,
      zip: true
    }

    switch (method) {
      case 'get':
        requestOpts.uri += '?' + _.map(data, (val, key) => {
          return [key, val].map(encodeURIComponent).join('=')
        }).join('&')
        break
      case 'post':
        requestOpts.method = 'POST'
        requestOpts.json = data
        break
    }

    let [response, body] = await request(requestOpts)
    if (response.statusCode !== 200) {
      throw new Error(`Response status code: ${response.statusCode}`)
    }

    let err
    switch (body.status) {
      case 'success':
        return body.data
      case 'fail':
        err = new Error.RequestError.StatusFail(requestOpts)
        err.data = body.data
        break
      case 'error':
        err = new Error.RequestError.StatusError(requestOpts)
        err.message = body.message
        break
      default:
        err = new Error.RequestError.StatusUnknow(requestOpts)
        break
    }

    throw err
  }

  return {
    get: _.partial(customRequest, 'get'),
    post: _.partial(customRequest, 'post'),
    errors: {
      StatusFail: Error.RequestError.StatusFail,
      StatusError: Error.RequestError.StatusError,
      StatusUnknow: Error.RequestError.StatusUnknow
    }
  }
}
