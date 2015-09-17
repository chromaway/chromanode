import { expect } from 'chai'

import request from './request'

export default function (opts) {
  it('version', async () => {
    let result = await request(opts, '/version')
    expect(result).to.deep.equal({
      version: require('../../package.json').version
    })
  })
}
