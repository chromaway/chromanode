import { expect } from 'chai'

export default function (opts) {
  let request = require('./request')(opts)

  it('version', async () => {
    let result = await request.get('/version')
    expect(result).to.deep.equal({
      version: require('../../package.json').version
    })
  })
}
