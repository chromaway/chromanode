import _ from 'lodash'
import urlJoin from 'url-join'
import PUtils from 'promise-useful-utils'

let request = PUtils.promisify(require('request'))

export default async function (opts, path, method, data) {
  var requestOpts = {
    method: 'GET',
    uri: urlJoin(`http://127.0.0.1:${opts.ports.slave}`, path),
    timeout: 5000,
    json: true,
    zip: true
  }

  if (method === 'GET') {
    requestOpts.uri += '?' + _.map(data, function (val, key) {
      return [key, val].map(encodeURIComponent).join('=')
    }).join('&')
  } else if (method === 'POST') {
    requestOpts.method = 'POST'
    requestOpts.json = data
  }

  let [response, body] = await request(requestOpts)
  if (response.statusCode !== 200) {
    throw new Error(`Response status code: ${response.statusCode}`)
  }

  switch (body.status) {
    case 'success':
      return body.data
    case 'fail':
      throw new Error(`Rsponse with status fail: ${body.data} (url: ${requestOpts.uri})`)
    case 'error':
      throw new Error(`Rsponse with status error: ${body.message} (url: ${requestOpts.uri})`)
    default:
      throw new Error(`Unknow status: ${body.status} (url: ${requestOpts.uri})`)
  }
}
