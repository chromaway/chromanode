import { expect } from 'chai'

import request from '../request'

export default function (opts) {
  it('status', async () => {
    let result = await request(opts, '/v2/status')
    expect(result).to.have.property('version', require('../../../package.json').version)
    expect(result).to.have.property('network', 'regtest')
  })
}
